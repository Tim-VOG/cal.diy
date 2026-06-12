import { prisma } from "@calcom/prisma";
import { ResourceBookingStatus } from "@calcom/prisma/enums";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { getResourceBookingRepository } from "../di/ResourceBookingRepository.container";
import { getResourceBookingService } from "../di/ResourceBookingService.container";
import { getAtomicSlotStarts } from "../lib/atomicSlots";

const service = getResourceBookingService();
const repo = getResourceBookingRepository();
const MS_PER_MINUTE = 60 * 1000;
const SLUG = `test-confirm-${Date.now()}`;

let resourceId: number;

async function createPendingBooking(startUtc: string, email: string): Promise<string> {
  const startTime = new Date(startUtc);
  const booking = await repo.createWithSlots({
    resourceId,
    startTime,
    endTime: new Date(startTime.getTime() + 60 * MS_PER_MINUTE),
    durationMinutes: 60,
    slotStarts: getAtomicSlotStarts(startTime, 60),
    bookerEmail: email,
    bookerName: email,
    amountTotal: 35000,
    currency: "EUR",
    status: ResourceBookingStatus.PENDING,
    holdExpiresAt: new Date(Date.now() + 15 * MS_PER_MINUTE),
  });
  return booking.uid;
}

describe("ResourceBookingService.confirmPayment", () => {
  beforeAll(async () => {
    const room = await prisma.resource.create({
      data: {
        name: "TEST Confirm Room",
        slug: SLUG,
        category: "ENTRY",
        capacity: 6,
        surface: 18,
        price1h: 35000,
        price2h: 65000,
        price3h: 90000,
      },
      select: { id: true },
    });
    resourceId = room.id;
  });

  afterEach(async () => {
    await prisma.resourceBooking.deleteMany({ where: { resourceId } });
  });

  afterAll(async () => {
    await prisma.resource.delete({ where: { id: resourceId } });
  });

  it("confirms a pending booking and stores the payment id", async () => {
    const uid = await createPendingBooking("2026-11-17T13:00:00.000Z", "pay@test.com");

    const confirmed = await service.confirmPayment({ bookingUid: uid, stripePaymentId: "pi_test_123" });

    expect(confirmed).toBe(true);
    const booking = await repo.findByUid(uid);
    expect(booking?.status).toBe(ResourceBookingStatus.CONFIRMED);
  });

  it("is idempotent: a second confirmation is a no-op", async () => {
    const uid = await createPendingBooking("2026-11-17T14:00:00.000Z", "again@test.com");

    expect(await service.confirmPayment({ bookingUid: uid, stripePaymentId: "pi_test_1" })).toBe(true);
    expect(await service.confirmPayment({ bookingUid: uid, stripePaymentId: "pi_test_2" })).toBe(false);
  });

  it("returns false for an unknown booking", async () => {
    expect(await service.confirmPayment({ bookingUid: "does-not-exist", stripePaymentId: "pi_x" })).toBe(
      false
    );
  });
});
