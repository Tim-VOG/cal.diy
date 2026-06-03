import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { prisma } from "@calcom/prisma";
import { ResourceBookingStatus } from "@calcom/prisma/enums";

import { getResourceBookingRepository } from "../di/ResourceBookingRepository.container";
import { getRoomAvailabilityService } from "../di/RoomAvailabilityService.container";
import { getAtomicSlotStarts } from "../lib/atomicSlots";

const service = getRoomAvailabilityService();
const bookingRepo = getResourceBookingRepository();

const SLUG = `test-availability-${Date.now()}`;
const MS_PER_MINUTE = 60 * 1000;

function dayStarts(days: Awaited<ReturnType<typeof service.getAvailabilityBySlug>>["days"], date: string) {
  const day = days.find((d) => d.date === date);
  if (!day) throw new Error(`day ${date} missing`);
  return day.starts;
}

async function book(startUtc: string, durationMinutes: number, status: ResourceBookingStatus, holdExpiresAt?: Date) {
  const startTime = new Date(startUtc);
  await bookingRepo.createWithSlots({
    resourceId,
    startTime,
    endTime: new Date(startTime.getTime() + durationMinutes * MS_PER_MINUTE),
    durationMinutes,
    slotStarts: getAtomicSlotStarts(startTime, durationMinutes),
    bookerEmail: "x@test.com",
    bookerName: "x",
    amountTotal: 25000,
    currency: "EUR",
    status,
    holdExpiresAt: holdExpiresAt ?? null,
  });
}

let resourceId: number;

describe("RoomAvailabilityService.getAvailabilityBySlug", () => {
  beforeAll(async () => {
    const room = await prisma.resource.create({
      data: { name: "TEST Availability Room", slug: SLUG, category: "ENTRY", capacity: 6, surface: 18, price1h: 25000, price2h: 50000, price3h: 65000 },
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

  it("returns the room and all three event days fully open when nothing is booked", async () => {
    const { room, days } = await service.getAvailabilityBySlug(SLUG);
    expect(room.slug).toBe(SLUG);
    expect(room.price3h).toBe(65000);
    expect(days.map((d) => d.date)).toEqual(["2026-11-17", "2026-11-18", "2026-11-19"]);
    expect(dayStarts(days, "2026-11-17")[0]).toEqual({
      startUtc: "2026-11-17T13:00:00.000Z",
      availableDurations: [1, 2, 3],
    });
  });

  it("hides a confirmed hour and longer durations spanning it", async () => {
    await book("2026-11-17T13:00:00.000Z", 60, ResourceBookingStatus.CONFIRMED);
    const { days } = await service.getAvailabilityBySlug(SLUG);
    // 13:00Z taken -> no durations; 14:00Z still offers 1h/2h.
    expect(dayStarts(days, "2026-11-17")[0]).toEqual({ startUtc: "2026-11-17T13:00:00.000Z", availableDurations: [] });
    expect(dayStarts(days, "2026-11-17")[1]).toEqual({ startUtc: "2026-11-17T14:00:00.000Z", availableDurations: [1, 2] });
  });

  it("blocks a pending hour while its hold is active", async () => {
    await book("2026-11-17T14:00:00.000Z", 60, ResourceBookingStatus.PENDING, new Date(Date.now() + 15 * MS_PER_MINUTE));
    const { days } = await service.getAvailabilityBySlug(SLUG);
    expect(dayStarts(days, "2026-11-17")[1].availableDurations).toEqual([]);
  });

  it("ignores a pending hour whose hold has expired", async () => {
    await book("2026-11-17T14:00:00.000Z", 60, ResourceBookingStatus.PENDING, new Date(Date.now() - MS_PER_MINUTE));
    const { days } = await service.getAvailabilityBySlug(SLUG);
    // Expired hold no longer blocks -> 14:00Z is open again.
    expect(dayStarts(days, "2026-11-17")[1].availableDurations).toEqual([1, 2]);
  });
});
