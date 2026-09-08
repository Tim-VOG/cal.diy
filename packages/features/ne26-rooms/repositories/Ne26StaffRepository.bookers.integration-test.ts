import { prisma } from "@calcom/prisma";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { getNe26StaffRepository } from "../di/Ne26StaffRepository.container";

/**
 * Removing an exhibitor account, and what has to survive it.
 *
 * The whole point is what is NOT deleted: an order carrying an invoice is a
 * numbered document counted in a VAT return, and it has to remain complete
 * months after the person's login is gone. Answered against a real database
 * because the answer depends on foreign keys — or rather on the deliberate
 * absence of one between an order and the account that placed it.
 */

const repo = getNe26StaffRepository();
const STAMP = Date.now();
const users: number[] = [];
const orders: string[] = [];
let resourceId: number;
let slot = 0;

async function makeUser(kind: "exhibitor" | "admin" | "hostess" = "exhibitor"): Promise<number> {
  const tag = `${STAMP}-${Math.random().toString(36).slice(2, 8)}`;
  const user = await prisma.user.create({
    data: {
      email: `booker-${tag}@test.local`,
      username: `booker-${tag}`,
      name: "TEST Booker",
      role: kind === "admin" ? "ADMIN" : "USER",
    },
  });
  users.push(user.id);
  if (kind === "hostess") {
    await prisma.ne26StaffRole.create({ data: { userId: user.id, role: "HOSTESS" } });
  }
  return user.id;
}

async function makeOrder(userId: number, invoiced: boolean, withRoom = true): Promise<string> {
  const start = new Date(Date.UTC(2026, 10, 18, 6 + slot++, 0, 0));
  const order = await prisma.ne26Order.create({
    data: {
      bookerUserId: userId,
      bookerEmail: `booker-${userId}@test.local`,
      bookerName: "TEST Booker",
      bookerLegalName: "Frozen Legal Name SAS",
      amountTotal: 35000,
      currency: "EUR",
      status: invoiced ? "CONFIRMED" : "PENDING",
      invoiceNumber: invoiced ? `NE26-BK-${STAMP}-${slot}` : null,
      ...(withRoom
        ? {
            bookings: {
              create: {
                resourceId,
                startTime: start,
                endTime: new Date(start.getTime() + 60 * 60 * 1000),
                durationMinutes: 60,
                bookerEmail: `booker-${userId}@test.local`,
                bookerName: "TEST Booker",
                amountTotal: 35000,
                currency: "EUR",
                status: invoiced ? "CONFIRMED" : "PENDING",
              },
            },
          }
        : {}),
    },
  });
  orders.push(order.uid);
  return order.uid;
}

beforeAll(async () => {
  const room = await prisma.resource.create({
    data: {
      name: "TEST Booker Room",
      slug: `test-booker-${STAMP}`,
      category: "ENTRY",
      capacity: 6,
      surface: 18,
      price1h: 35000,
      price2h: 60000,
      price3h: 80000,
    },
  });
  resourceId = room.id;
});

afterEach(async () => {
  if (orders.length) {
    await prisma.resourceBooking.deleteMany({ where: { orderUid: { in: orders } } });
    await prisma.ne26Order.deleteMany({ where: { uid: { in: orders } } });
    orders.length = 0;
  }
  if (users.length) {
    await prisma.user.deleteMany({ where: { id: { in: users } } });
    users.length = 0;
  }
});

describe("listBookerAccounts", () => {
  it("shows someone who registered and has never booked", async () => {
    // The reason this list exists: the Bookers table is built from bookings, so
    // it cannot see this person at all.
    const id = await makeUser();
    const found = (await repo.listBookerAccounts()).find((a) => a.userId === id);
    expect(found).toBeDefined();
    expect(found?.undocumentedOrders).toBe(0);
    expect(found?.documentedOrders).toBe(0);
  });

  it("counts what would go and what would stay, separately", async () => {
    const id = await makeUser();
    await makeOrder(id, false);
    await makeOrder(id, false);
    await makeOrder(id, true);

    const found = (await repo.listBookerAccounts()).find((a) => a.userId === id);
    expect(found?.undocumentedOrders).toBe(2);
    expect(found?.documentedOrders).toBe(1);
  });

  it("leaves staff out — they are managed on the Access page", async () => {
    const admin = await makeUser("admin");
    const hostess = await makeUser("hostess");
    const ids = (await repo.listBookerAccounts()).map((a) => a.userId);
    expect(ids).not.toContain(admin);
    expect(ids).not.toContain(hostess);
  });
});

describe("deleteBookerAccount", () => {
  it("removes the account and the bookings that never became a document", async () => {
    const id = await makeUser();
    const uid = await makeOrder(id, false);

    const result = await repo.deleteBookerAccount(id);

    expect(result).toMatchObject({ deleted: true, ordersDeleted: 1, ordersKept: 0 });
    expect(await prisma.user.findUnique({ where: { id } })).toBeNull();
    expect(await prisma.ne26Order.findUnique({ where: { uid } })).toBeNull();
    // The cascade is what puts the room back on sale.
    expect(await prisma.resourceBooking.count({ where: { orderUid: uid } })).toBe(0);
  });

  it("keeps an invoiced order, complete, once its account is gone", async () => {
    // The one that matters. There is no foreign key from an order to the
    // account, and the order froze the buyer's details at the time of sale —
    // which is what lets the accountant read it months later.
    const id = await makeUser();
    const kept = await makeOrder(id, true);
    const gone = await makeOrder(id, false);

    const result = await repo.deleteBookerAccount(id);

    expect(result).toMatchObject({ deleted: true, ordersDeleted: 1, ordersKept: 1 });
    const order = await prisma.ne26Order.findUnique({
      where: { uid: kept },
      include: { bookings: true },
    });
    expect(order).not.toBeNull();
    expect(order?.invoiceNumber).toBeTruthy();
    expect(order?.bookerEmail).toContain("@test.local");
    expect(order?.bookerLegalName).toBe("Frozen Legal Name SAS");
    expect(order?.bookings).toHaveLength(1);
    expect(await prisma.ne26Order.findUnique({ where: { uid: gone } })).toBeNull();
  });

  it("refuses an administrator", async () => {
    const id = await makeUser("admin");
    expect(await repo.deleteBookerAccount(id)).toMatchObject({ deleted: false, refusedBecause: "staff" });
    expect(await prisma.user.findUnique({ where: { id } })).not.toBeNull();
  });

  it("refuses a hostess", async () => {
    const id = await makeUser("hostess");
    expect(await repo.deleteBookerAccount(id)).toMatchObject({ deleted: false, refusedBecause: "staff" });
    expect(await prisma.user.findUnique({ where: { id } })).not.toBeNull();
  });

  it("says so rather than throwing for an account that is already gone", async () => {
    expect(await repo.deleteBookerAccount(0)).toMatchObject({ deleted: false, refusedBecause: "missing" });
  });

  it("touches nobody else's orders", async () => {
    const mine = await makeUser();
    const theirs = await makeUser();
    const untouched = await makeOrder(theirs, false);
    await makeOrder(mine, false);

    await repo.deleteBookerAccount(mine);

    expect(await prisma.ne26Order.findUnique({ where: { uid: untouched } })).not.toBeNull();
    expect(await prisma.user.findUnique({ where: { id: theirs } })).not.toBeNull();
  });
});
