import { prisma } from "@calcom/prisma";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { getNe26AccountRepository } from "../di/Ne26AccountRepository.container";
import { getAtomicSlotStarts } from "../lib/atomicSlots";
import { AccountEmailService, EmailChangeRefused } from "./AccountEmailService";

const STAMP = Date.now();
const OLD = `old-${STAMP}@moodys.com`;
const NEW = `New-${STAMP}@moodys.com`;
const accounts = getNe26AccountRepository();

let userId: number;
let otherUserId: number;
let roomId: number;
const audit: { action: string; detail?: string; actorRole: string }[] = [];
const stripeUpdates: { customerId: string; email: string }[] = [];

const service = (password: { accepts: boolean } = { accepts: true }) =>
  new AccountEmailService({
    accounts,
    customers: {
      updateCustomerEmail: async (customerId, email) => {
        stripeUpdates.push({ customerId, email });
      },
    },
    verifyPassword: async () => password.accepts,
    recordAction: async (input) => {
      audit.push({ action: input.action, detail: input.detail, actorRole: input.actorRole });
    },
  });

describe("AccountEmailService", () => {
  beforeAll(async () => {
    const room = await prisma.resource.create({
      data: {
        name: `TEST Email Room ${STAMP}`,
        slug: `test-email-${STAMP}`,
        category: "ENTRY",
        capacity: 6,
        surface: 18,
        price1h: 30000,
        price2h: 54000,
        price3h: 76500,
      },
      select: { id: true },
    });
    roomId = room.id;
    const other = await prisma.user.create({
      data: { email: `taken-${STAMP}@moodys.com`, username: `taken-${STAMP}` },
      select: { id: true },
    });
    otherUserId = other.id;
  });

  beforeEach(async () => {
    audit.length = 0;
    stripeUpdates.length = 0;
    const user = await prisma.user.create({
      data: {
        email: OLD,
        username: `old-${STAMP}`,
        name: "Robinah Nayiga",
        // They sign in with a password, and changing this address changes the
        // login — so the service asks for it.
        password: { create: { hash: "$2a$10$notarealhashnotarealhashnotarealhash" } },
      },
      select: { id: true },
    });
    userId = user.id;
    await prisma.ne26BillingProfile.create({
      data: { userId, country: "GB", stripeCustomerId: `cus_${STAMP}` },
    });
    // What they bought carries a copy of the address, and that copy is what the
    // resend button mails and the Bookers list groups by.
    const start = new Date("2026-11-17T13:00:00.000Z");
    await prisma.ne26Order.create({
      data: {
        bookerUserId: userId,
        bookerEmail: OLD,
        bookerName: "Robinah Nayiga",
        amountTotal: 30000,
        currency: "EUR",
        status: "CONFIRMED",
        invoiceNumber: `NE26-2026-E${STAMP.toString().slice(-4)}`,
        bookings: {
          create: {
            resourceId: roomId,
            startTime: start,
            endTime: new Date(start.getTime() + 3600_000),
            durationMinutes: 60,
            bookerUserId: userId,
            bookerEmail: OLD,
            bookerName: "Robinah Nayiga",
            status: "CONFIRMED",
            amountTotal: 30000,
            currency: "EUR",
            slots: {
              create: getAtomicSlotStarts(start, 60).map((slotStart) => ({ resourceId: roomId, slotStart })),
            },
          },
        },
      },
    });
  });

  afterEach(async () => {
    await prisma.ne26Order.deleteMany({ where: { bookerUserId: userId } });
    await prisma.resourceBooking.deleteMany({ where: { bookerUserId: userId } });
    await prisma.ne26BillingProfile.deleteMany({ where: { userId } });
    await prisma.user.delete({ where: { id: userId } });
  });

  afterAll(async () => {
    await prisma.resource.delete({ where: { id: roomId } });
    await prisma.user.delete({ where: { id: otherUserId } });
  });

  it("moves the account and everything bought under it, normalised", async () => {
    const result = await service().changeOwnEmail(userId, NEW, "hunter2");

    const normalised = NEW.toLowerCase();
    expect(result.email).toBe(normalised);
    expect((await prisma.user.findUnique({ where: { id: userId } }))?.email).toBe(normalised);
    // The copies move too, or a resent invoice goes to the address they just
    // told us was wrong, and they show up twice in the Bookers list.
    expect(await prisma.ne26Order.count({ where: { bookerUserId: userId, bookerEmail: normalised } })).toBe(
      1
    );
    expect(
      await prisma.resourceBooking.count({ where: { bookerUserId: userId, bookerEmail: normalised } })
    ).toBe(1);
  });

  it("leaves the booking itself alone — this is a contact detail, not a sale", async () => {
    const before = await prisma.ne26Order.findFirstOrThrow({ where: { bookerUserId: userId } });

    await service().changeOwnEmail(userId, NEW, "hunter2");

    const after = await prisma.ne26Order.findFirstOrThrow({ where: { bookerUserId: userId } });
    expect(after).toMatchObject({
      invoiceNumber: before.invoiceNumber,
      amountTotal: before.amountTotal,
      status: before.status,
      bookerName: before.bookerName,
    });
    expect(await prisma.resourceSlot.count({ where: { booking: { bookerUserId: userId } } })).toBe(4);
  });

  it("keeps the Stripe mirror in step, and writes the change to the trail", async () => {
    await service().changeOwnEmail(userId, NEW, "hunter2");

    expect(stripeUpdates).toEqual([{ customerId: `cus_${STAMP}`, email: NEW.toLowerCase() }]);
    expect(audit).toEqual([
      {
        action: "account.email.change",
        actorRole: "USER",
        detail: `Email: ${OLD} → ${NEW.toLowerCase()}`,
      },
    ]);
  });

  it("refuses a wrong password, and changes nothing", async () => {
    await expect(service({ accepts: false }).changeOwnEmail(userId, NEW, "wrong")).rejects.toBeInstanceOf(
      EmailChangeRefused
    );

    expect((await prisma.user.findUnique({ where: { id: userId } }))?.email).toBe(OLD);
    expect(stripeUpdates).toEqual([]);
    expect(audit).toEqual([]);
  });

  it("refuses an address another account already signs in with", async () => {
    await expect(
      service().changeOwnEmail(userId, `TAKEN-${STAMP}@moodys.com`, "hunter2")
    ).rejects.toMatchObject({ reason: "taken" });

    expect((await prisma.user.findUnique({ where: { id: userId } }))?.email).toBe(OLD);
  });

  it("lets an admin correct it without a password, logged as an admin action", async () => {
    const result = await service().changeEmailAsAdmin(userId, NEW, { id: 1, email: "admin@vo-europe.eu" });

    expect(result.email).toBe(NEW.toLowerCase());
    expect(audit[0]).toMatchObject({ action: "account.email.change.admin", actorRole: "ADMIN" });
    expect(audit[0].detail).toContain(OLD);
  });

  it("refuses an account that does not exist", async () => {
    await expect(
      service().changeEmailAsAdmin(999_999_999, NEW, { id: 1, email: "admin@vo-europe.eu" })
    ).rejects.toMatchObject({ reason: "not-found" });
  });
});
