import { ErrorCode } from "@calcom/lib/errorCodes";
import { ErrorWithCode } from "@calcom/lib/errors";
import { prisma } from "@calcom/prisma";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { getResourceBookingRepository } from "../di/ResourceBookingRepository.container";
import { getAtomicSlotStarts } from "../lib/atomicSlots";

const repo = getResourceBookingRepository();

const MS_PER_MINUTE = 60 * 1000;

function bookingArgs(startTime: Date, durationMinutes: number, email: string, resourceId: number) {
  return {
    resourceId,
    startTime,
    endTime: new Date(startTime.getTime() + durationMinutes * MS_PER_MINUTE),
    durationMinutes,
    slotStarts: getAtomicSlotStarts(startTime, durationMinutes),
    bookerEmail: email,
    bookerName: email,
    amountTotal: 10000,
    currency: "EUR",
  };
}

describe("ResourceBookingRepository.createWithSlots — anti-double-booking", () => {
  let resourceId: number;

  beforeAll(async () => {
    const resource = await prisma.resource.create({
      data: {
        name: "TEST Concurrency Room",
        slug: `test-concurrency-${Date.now()}`,
        category: "ENTRY",
        capacity: 6,
        surface: 18,
        price1h: 25000,
        price2h: 50000,
        price3h: 65000,
      },
      select: { id: true },
    });
    resourceId = resource.id;
  });

  afterEach(async () => {
    // Cascade removes the booking's ResourceSlot rows too.
    await prisma.resourceBooking.deleteMany({ where: { resourceId } });
  });

  afterAll(async () => {
    await prisma.resource.delete({ where: { id: resourceId } });
  });

  it("lets only one of two concurrent bookings take the same room+hour", async () => {
    const startTime = new Date("2026-11-17T09:00:00.000Z");

    const results = await Promise.allSettled([
      repo.createWithSlots(bookingArgs(startTime, 60, "a@test.com", resourceId)),
      repo.createWithSlots(bookingArgs(startTime, 60, "b@test.com", resourceId)),
    ]);

    const fulfilled = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter((r): r is PromiseRejectedResult => r.status === "rejected");

    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(rejected[0].reason).toBeInstanceOf(ErrorWithCode);
    expect((rejected[0].reason as ErrorWithCode).code).toBe(ErrorCode.BookingConflict);

    const slotCount = await prisma.resourceSlot.count({ where: { resourceId, slotStart: startTime } });
    expect(slotCount).toBe(1);
  });

  it("rejects a 1h booking that overlaps an existing 3h booking on a shared hour", async () => {
    // 14:00–17:00 occupies atomic hours 14, 15, 16.
    await repo.createWithSlots(
      bookingArgs(new Date("2026-11-17T14:00:00.000Z"), 180, "long@test.com", resourceId)
    );

    // 15:00–16:00 needs hour 15, which is taken — must be rejected despite a different startTime.
    await expect(
      repo.createWithSlots(
        bookingArgs(new Date("2026-11-17T15:00:00.000Z"), 60, "short@test.com", resourceId)
      )
    ).rejects.toMatchObject({ code: ErrorCode.BookingConflict });

    const bookingCount = await prisma.resourceBooking.count({ where: { resourceId } });
    expect(bookingCount).toBe(1);
  });

  it("allows two non-overlapping bookings on the same room", async () => {
    const first = await repo.createWithSlots(
      bookingArgs(new Date("2026-11-18T09:00:00.000Z"), 120, "first@test.com", resourceId)
    );
    const second = await repo.createWithSlots(
      bookingArgs(new Date("2026-11-18T11:00:00.000Z"), 60, "second@test.com", resourceId)
    );

    expect(first.id).not.toBe(second.id);
    const bookingCount = await prisma.resourceBooking.count({ where: { resourceId } });
    expect(bookingCount).toBe(2);
  });
});

describe("ResourceBookingRepository.updateBillingFromCheckout — never downgrade", () => {
  let resourceId: number;

  beforeAll(async () => {
    const resource = await prisma.resource.create({
      data: {
        name: "TEST Checkout Billing Room",
        slug: `test-checkout-billing-${Date.now()}`,
        category: "ENTRY",
        capacity: 6,
        surface: 18,
        price1h: 25000,
        price2h: 50000,
        price3h: 65000,
      },
      select: { id: true },
    });
    resourceId = resource.id;
  });

  afterEach(async () => {
    await prisma.resourceBooking.deleteMany({ where: { resourceId } });
  });

  afterAll(async () => {
    await prisma.resource.delete({ where: { id: resourceId } });
  });

  async function bookingWithBelgianProfile(startTime: Date) {
    const created = await repo.createWithSlots({
      ...bookingArgs(startTime, 60, "vat@test.com", resourceId),
      bookerCountry: "BE",
      bookerVatNumber: "BE0123456789",
    });
    return created.uid;
  }

  it("keeps the profile's country and VAT number when Checkout returns nothing", async () => {
    // Stripe only collects the address "when necessary", so customer_details can
    // come back without one. Overwriting BE with null would move the invoice off
    // Belgian VAT — a tax change nobody asked for.
    const uid = await bookingWithBelgianProfile(new Date("2026-11-17T10:00:00.000Z"));

    await repo.updateBillingFromCheckout(uid, { country: null, vatNumber: null, name: null });

    const booking = await repo.findByUidForInvoice(uid);
    expect(booking?.bookerCountry).toBe("BE");
    expect(booking?.bookerVatNumber).toBe("BE0123456789");
  });

  it("treats a blank string the same as missing", async () => {
    const uid = await bookingWithBelgianProfile(new Date("2026-11-17T11:00:00.000Z"));

    await repo.updateBillingFromCheckout(uid, { country: "", vatNumber: "   ", name: "" });

    const booking = await repo.findByUidForInvoice(uid);
    expect(booking?.bookerCountry).toBe("BE");
    expect(booking?.bookerVatNumber).toBe("BE0123456789");
    expect(booking?.bookerName).toBe("vat@test.com");
  });

  it("still applies what the buyer actually confirmed at Checkout", async () => {
    const uid = await bookingWithBelgianProfile(new Date("2026-11-17T12:00:00.000Z"));

    await repo.updateBillingFromCheckout(uid, {
      country: "FR",
      vatNumber: "FR12345678901",
      name: "Societe Generale",
    });

    const booking = await repo.findByUidForInvoice(uid);
    expect(booking?.bookerCountry).toBe("FR");
    expect(booking?.bookerVatNumber).toBe("FR12345678901");
    expect(booking?.bookerName).toBe("Societe Generale");
  });
});

describe("ResourceBookingRepository — the welcome desk", () => {
  let resourceId: number;

  beforeAll(async () => {
    const resource = await prisma.resource.create({
      data: {
        name: "TEST Desk Room",
        slug: `test-desk-${Date.now()}`,
        category: "ENTRY",
        capacity: 6,
        surface: 18,
        price1h: 25000,
        price2h: 50000,
        price3h: 65000,
      },
      select: { id: true },
    });
    resourceId = resource.id;
  });

  afterEach(async () => {
    await prisma.resourceBooking.deleteMany({ where: { resourceId } });
  });

  afterAll(async () => {
    await prisma.resource.delete({ where: { id: resourceId } });
  });

  async function booking(startTime: Date, over: Record<string, unknown> = {}) {
    const created = await repo.createWithSlots(
      bookingArgs(startTime, 60, "desk@test.com", resourceId)
    );
    if (Object.keys(over).length) {
      await prisma.resourceBooking.update({ where: { uid: created.uid }, data: over });
    }
    return created.uid;
  }

  it("refuses to check in a booking that has not been paid for", async () => {
    // A hostess must never greet someone into a room they have not bought. The
    // desk only ever lists CONFIRMED bookings, but the mutation takes a uid, so
    // the rule has to hold at this layer too.
    const uid = await booking(new Date("2026-11-19T09:00:00.000Z"));

    expect(await repo.setCheckedIn(uid, new Date(), "hostess@vo-group.be")).toBe(false);

    const row = await prisma.resourceBooking.findUniqueOrThrow({
      where: { uid },
      select: { checkedInAt: true },
    });
    expect(row.checkedInAt).toBeNull();
  });

  it("checks in a confirmed booking and records who did it", async () => {
    const uid = await booking(new Date("2026-11-19T10:00:00.000Z"), {
      status: "CONFIRMED",
      holdExpiresAt: null,
    });

    expect(await repo.setCheckedIn(uid, new Date(), "hostess@vo-group.be")).toBe(true);

    const row = await prisma.resourceBooking.findUniqueOrThrow({
      where: { uid },
      select: { checkedInAt: true, checkedInByEmail: true },
    });
    expect(row.checkedInAt).not.toBeNull();
    expect(row.checkedInByEmail).toBe("hostess@vo-group.be");
  });

  it("clears a mistaken check-in, and the operator with it", async () => {
    const uid = await booking(new Date("2026-11-19T11:00:00.000Z"), {
      status: "CONFIRMED",
      holdExpiresAt: null,
    });
    await repo.setCheckedIn(uid, new Date(), "hostess@vo-group.be");

    expect(await repo.setCheckedIn(uid, null, null)).toBe(true);

    const row = await prisma.resourceBooking.findUniqueOrThrow({
      where: { uid },
      select: { checkedInAt: true, checkedInByEmail: true },
    });
    expect(row.checkedInAt).toBeNull();
    expect(row.checkedInByEmail).toBeNull();
  });

  it("keeps unpaid holds out of the desk's day view", async () => {
    await booking(new Date("2026-11-19T13:00:00.000Z"));
    const confirmed = await booking(new Date("2026-11-19T14:00:00.000Z"), {
      status: "CONFIRMED",
      holdExpiresAt: null,
    });

    const rows = await repo.findForDesk(
      new Date("2026-11-19T00:00:00.000Z"),
      new Date("2026-11-20T00:00:00.000Z")
    );
    const mine = rows.filter((r) => r.resource.name === "TEST Desk Room");
    expect(mine.map((r) => r.uid)).toEqual([confirmed]);
  });
});
