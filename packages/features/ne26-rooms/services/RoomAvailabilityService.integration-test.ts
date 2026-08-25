import { prisma } from "@calcom/prisma";
import { ResourceBookingStatus } from "@calcom/prisma/enums";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
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

/**
 * Durations offered at one start, or [] when the start is not offered at all.
 *
 * Offered times chain from one booking to the next, so an unavailable start is
 * simply absent rather than present with an empty list — asserting by index
 * would silently follow whichever start happened to shuffle into that position.
 */
function durationsAt(
  days: Awaited<ReturnType<typeof service.getAvailabilityBySlug>>["days"],
  date: string,
  startUtc: string
): number[] {
  return dayStarts(days, date).find((s) => s.startUtc === startUtc)?.availableDurations ?? [];
}

async function book(
  startUtc: string,
  durationMinutes: number,
  status: ResourceBookingStatus,
  holdExpiresAt?: Date
) {
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
      data: {
        name: "TEST Availability Room",
        slug: SLUG,
        category: "ENTRY",
        capacity: 6,
        surface: 18,
        price1h: 25000,
        price2h: 50000,
        price3h: 65000,
      },
      select: { id: true },
    });
    resourceId = room.id;

    // Pin the cleaning gap: it is a shared admin setting, so leaving it to
    // whatever another suite last wrote makes the offered times non-deterministic.
    await prisma.ne26RoomSettings.upsert({
      where: { id: 1 },
      update: { bufferMinutes: 0 },
      create: { id: 1, bufferMinutes: 0 },
    });
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
    expect(durationsAt(days, "2026-11-17", "2026-11-17T11:00:00.000Z")).toEqual([1, 2, 3]);
  });

  it("hides a confirmed hour and longer durations spanning it", async () => {
    await book("2026-11-17T11:00:00.000Z", 60, ResourceBookingStatus.CONFIRMED);
    const { days } = await service.getAvailabilityBySlug(SLUG);
    // 13:00Z is taken, so it is not on offer at all; 14:00Z still sells 1h/2h.
    expect(durationsAt(days, "2026-11-17", "2026-11-17T11:00:00.000Z")).toEqual([]);
    expect(durationsAt(days, "2026-11-17", "2026-11-17T12:00:00.000Z")).toEqual([1, 2]);
  });

  it("blocks a pending hour while its hold is active", async () => {
    await book(
      "2026-11-17T12:00:00.000Z",
      60,
      ResourceBookingStatus.PENDING,
      new Date(Date.now() + 15 * MS_PER_MINUTE)
    );
    const { days } = await service.getAvailabilityBySlug(SLUG);
    expect(durationsAt(days, "2026-11-17", "2026-11-17T12:00:00.000Z")).toEqual([]);
  });

  it("ignores a pending hour whose hold has expired", async () => {
    await book(
      "2026-11-17T12:00:00.000Z",
      60,
      ResourceBookingStatus.PENDING,
      new Date(Date.now() - MS_PER_MINUTE)
    );
    const { days } = await service.getAvailabilityBySlug(SLUG);
    // Expired hold no longer blocks -> 14:00Z is on offer again.
    //
    // 1h only, not 1h/2h: offered times chain, and the two-hour chain runs
    // 13:00-15:00, so it steps straight over 14:00. The 14:00-16:00 pair is free
    // but is not on the two-hour sequence.
    expect(durationsAt(days, "2026-11-17", "2026-11-17T12:00:00.000Z")).toEqual([1]);
  });

  describe("getAvailabilityForAllRooms — the desk grid", () => {
    it("agrees with the per-room read, room for room", async () => {
      // The grid is built in three queries instead of 3n. The two paths
      // disagreeing would mean the hostess and the buyer seeing different rooms
      // as free, which is how a room gets sold twice.
      await book("2026-11-17T11:00:00.000Z", 60, ResourceBookingStatus.CONFIRMED);

      const all = await service.getAvailabilityForAllRooms();
      const mine = all.find((a) => a.room.slug === SLUG);
      const single = await service.getAvailabilityBySlug(SLUG);

      expect(mine?.days).toEqual(single.days);
    });

    it("keeps each room's bookings to itself", async () => {
      // One query now covers every room, so a mis-grouped slot would show one
      // room's booking as blocking another's.
      const other = await prisma.resource.create({
        data: {
          name: "TEST Availability Neighbour",
          slug: `${SLUG}-neighbour`,
          category: "ENTRY",
          capacity: 6,
          surface: 18,
          price1h: 25000,
          price2h: 50000,
          price3h: 65000,
        },
        select: { id: true, slug: true },
      });
      try {
        await book("2026-11-17T11:00:00.000Z", 60, ResourceBookingStatus.CONFIRMED);

        const all = await service.getAvailabilityForAllRooms();
        const neighbour = all.find((a) => a.room.slug === other.slug);
        const start = neighbour?.days
          .find((d) => d.date === "2026-11-17")
          ?.starts.find((s) => s.startUtc === "2026-11-17T11:00:00.000Z");

        expect(start?.availableDurations).toContain(1);
      } finally {
        await prisma.resourceBooking.deleteMany({ where: { resourceId: other.id } });
        await prisma.resource.delete({ where: { id: other.id } });
      }
    });
  });
});
