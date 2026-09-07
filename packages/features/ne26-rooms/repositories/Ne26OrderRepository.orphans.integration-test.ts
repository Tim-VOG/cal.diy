import { prisma } from "@calcom/prisma";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { getNe26OrderRepository } from "../di/Ne26OrderRepository.container";

/**
 * Orders that hold no rooms: which ones the dashboard shouts about, and which
 * ones an admin is allowed to close.
 *
 * Both questions are about money that has moved, so both are answered against a
 * real database rather than a mock: the close is a single guarded UPDATE, and
 * the guard is the whole point of it.
 */

const repo = getNe26OrderRepository();
const madeHere: string[] = [];
let resourceId: number;

async function makeOrder(data: {
  status?: "PENDING" | "CONFIRMED" | "CANCELLED";
  stripePaymentId?: string | null;
  invoiceNumber?: string | null;
  creditNoteNumber?: string | null;
  withRoom?: boolean;
}): Promise<string> {
  const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const order = await prisma.ne26Order.create({
    data: {
      bookerEmail: `orphan-${stamp}@test.local`,
      bookerName: "TEST Orphan",
      amountTotal: 72000,
      currency: "EUR",
      status: data.status ?? "PENDING",
      stripePaymentId: data.stripePaymentId ?? null,
      invoiceNumber: data.invoiceNumber ?? null,
      creditNoteNumber: data.creditNoteNumber ?? null,
    },
  });
  madeHere.push(order.uid);
  if (data.withRoom) {
    const start = new Date("2026-11-17T09:00:00.000Z");
    await prisma.resourceBooking.create({
      data: {
        resourceId,
        orderUid: order.uid,
        startTime: start,
        endTime: new Date(start.getTime() + 60 * 60 * 1000),
        durationMinutes: 60,
        bookerEmail: order.bookerEmail,
        bookerName: order.bookerName,
        amountTotal: 72000,
        currency: "EUR",
        status: data.status ?? "PENDING",
      },
    });
  }
  return order.uid;
}

beforeAll(async () => {
  const resource = await prisma.resource.create({
    data: {
      name: "TEST Orphan Room",
      slug: `test-orphan-${Date.now()}`,
      category: "ENTRY",
      capacity: 6,
      surface: 18,
      price1h: 25000,
      price2h: 50000,
      price3h: 65000,
    },
  });
  resourceId = resource.id;
});

afterEach(async () => {
  if (madeHere.length) {
    await prisma.resourceBooking.deleteMany({ where: { orderUid: { in: madeHere } } });
    await prisma.ne26Order.deleteMany({ where: { uid: { in: madeHere } } });
    madeHere.length = 0;
  }
});

describe("findOrdersWithoutRooms", () => {
  it("shows an order that was paid and holds nothing", async () => {
    const uid = await makeOrder({ stripePaymentId: `pi_test_${Date.now()}` });
    const found = await repo.findOrdersWithoutRooms();
    expect(found.map((o) => o.uid)).toContain(uid);
  });

  it("does not show a refunded order that was credited", async () => {
    // The regression this exists for. Issuing a credit note DELETES the order's
    // rooms, so every properly refunded order left this query holding no rooms
    // and carrying a payment id — and was announced in red as money captured
    // with the rooms gone. Business already finished. Over a three-day event
    // the panel that catches the one real disaster would have filled with
    // resolved refunds long before the disaster arrived.
    const uid = await makeOrder({
      status: "CANCELLED",
      stripePaymentId: `pi_credited_${Date.now()}`,
      invoiceNumber: `NE26-TEST-${Date.now()}`,
      creditNoteNumber: `NE26-CN-TEST-${Date.now()}`,
    });
    const found = await repo.findOrdersWithoutRooms();
    expect(found.map((o) => o.uid)).not.toContain(uid);
  });

  it("does not show an order that still holds a room", async () => {
    const uid = await makeOrder({ withRoom: true });
    const found = await repo.findOrdersWithoutRooms();
    expect(found.map((o) => o.uid)).not.toContain(uid);
  });
});

describe("closeSettledOrder", () => {
  it("closes a pending order that holds nothing, and keeps the money trail", async () => {
    const paymentId = `pi_settled_${Date.now()}`;
    const uid = await makeOrder({ stripePaymentId: paymentId });

    expect(await repo.closeSettledOrder(uid)).toBe(true);

    const after = await prisma.ne26Order.findUnique({ where: { uid } });
    expect(after?.status).toBe("CANCELLED");
    // Cancelled, never deleted: the payment id and the amount are what the
    // accountant reconciles this against in Stripe, months later.
    expect(after?.stripePaymentId).toBe(paymentId);
    expect(after?.amountTotal).toBe(72000);
  });

  it("clears it from the dashboard", async () => {
    const uid = await makeOrder({ stripePaymentId: `pi_clear_${Date.now()}` });
    await repo.closeSettledOrder(uid);
    expect((await repo.findOrdersWithoutRooms()).map((o) => o.uid)).not.toContain(uid);
  });

  it("refuses an order that is holding a room", async () => {
    // The guard that matters. Closing an order with a live hold would strand a
    // room: CANCELLED on the order, still PENDING and still unsellable on the
    // booking. The check is inside the UPDATE, not a read before it, so a room
    // attached a millisecond earlier cannot slip through.
    const uid = await makeOrder({ withRoom: true });

    expect(await repo.closeSettledOrder(uid)).toBe(false);

    const after = await prisma.ne26Order.findUnique({ where: { uid } });
    expect(after?.status).toBe("PENDING");
  });

  it("refuses a confirmed order", async () => {
    // A confirmed order was paid for and, if it has an invoice, has to be
    // credited rather than quietly cancelled.
    const uid = await makeOrder({ status: "CONFIRMED", stripePaymentId: `pi_conf_${Date.now()}` });
    expect(await repo.closeSettledOrder(uid)).toBe(false);
    expect((await prisma.ne26Order.findUnique({ where: { uid } }))?.status).toBe("CONFIRMED");
  });

  it("says false the second time rather than pretending it did something", async () => {
    const uid = await makeOrder({});
    expect(await repo.closeSettledOrder(uid)).toBe(true);
    expect(await repo.closeSettledOrder(uid)).toBe(false);
  });

  it("says false for an order that does not exist", async () => {
    expect(await repo.closeSettledOrder("00000000-0000-0000-0000-000000000000")).toBe(false);
  });
});

describe("findForAdmin", () => {
  it("finds an order that holds no rooms — the one no room page can reach", async () => {
    const uid = await makeOrder({ stripePaymentId: `pi_admin_${Date.now()}` });
    const order = await repo.findForAdmin(uid);
    expect(order?.uid).toBe(uid);
    expect(order?.bookings).toEqual([]);
  });

  it("brings the rooms and their names with it", async () => {
    const uid = await makeOrder({ withRoom: true });
    const order = await repo.findForAdmin(uid);
    expect(order?.bookings[0]?.resource.name).toBe("TEST Orphan Room");
  });
});
