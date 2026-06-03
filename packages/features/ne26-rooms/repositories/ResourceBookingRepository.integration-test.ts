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
