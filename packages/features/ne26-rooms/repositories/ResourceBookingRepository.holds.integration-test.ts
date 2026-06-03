import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { ErrorCode } from "@calcom/lib/errorCodes";
import { prisma } from "@calcom/prisma";
import { ResourceBookingStatus } from "@calcom/prisma/enums";

import { getResourceBookingRepository } from "../di/ResourceBookingRepository.container";
import { getAtomicSlotStarts } from "../lib/atomicSlots";

const repo = getResourceBookingRepository();
const MS_PER_MINUTE = 60 * 1000;
const SLUG = `test-holds-${Date.now()}`;

let resourceId: number;

function args(startUtc: string, status: ResourceBookingStatus, holdExpiresAt: Date | null, email: string) {
  const startTime = new Date(startUtc);
  return {
    resourceId,
    startTime,
    endTime: new Date(startTime.getTime() + 60 * MS_PER_MINUTE),
    durationMinutes: 60,
    slotStarts: getAtomicSlotStarts(startTime, 60),
    bookerEmail: email,
    bookerName: email,
    amountTotal: 35000,
    currency: "EUR",
    status,
    holdExpiresAt,
  };
}

describe("ResourceBookingRepository.createWithSlots — expired hold reclaim", () => {
  beforeAll(async () => {
    const room = await prisma.resource.create({
      data: { name: "TEST Holds Room", slug: SLUG, category: "ENTRY", capacity: 6, surface: 18, price1h: 35000, price2h: 65000, price3h: 90000 },
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

  it("reclaims an expired pending hold so a new booking can take the slot", async () => {
    await repo.createWithSlots(
      args("2026-11-17T13:00:00.000Z", ResourceBookingStatus.PENDING, new Date(Date.now() - MS_PER_MINUTE), "stale@test.com")
    );
    const fresh = await repo.createWithSlots(
      args("2026-11-17T13:00:00.000Z", ResourceBookingStatus.PENDING, new Date(Date.now() + 15 * MS_PER_MINUTE), "new@test.com")
    );

    expect(fresh.uid).toBeTruthy();
    expect(await prisma.resourceBooking.count({ where: { resourceId } })).toBe(1); // stale hold deleted
    expect(
      await prisma.resourceSlot.count({ where: { resourceId, slotStart: new Date("2026-11-17T13:00:00.000Z") } })
    ).toBe(1);
  });

  it("does NOT reclaim an active hold (still a conflict)", async () => {
    await repo.createWithSlots(
      args("2026-11-17T14:00:00.000Z", ResourceBookingStatus.PENDING, new Date(Date.now() + 15 * MS_PER_MINUTE), "active@test.com")
    );
    await expect(
      repo.createWithSlots(
        args("2026-11-17T14:00:00.000Z", ResourceBookingStatus.PENDING, new Date(Date.now() + 15 * MS_PER_MINUTE), "other@test.com")
      )
    ).rejects.toMatchObject({ code: ErrorCode.BookingConflict });
  });

  it("does NOT reclaim a confirmed booking (still a conflict)", async () => {
    await repo.createWithSlots(
      args("2026-11-18T08:00:00.000Z", ResourceBookingStatus.CONFIRMED, null, "paid@test.com")
    );
    await expect(
      repo.createWithSlots(
        args("2026-11-18T08:00:00.000Z", ResourceBookingStatus.PENDING, new Date(Date.now() + 15 * MS_PER_MINUTE), "late@test.com")
      )
    ).rejects.toMatchObject({ code: ErrorCode.BookingConflict });
  });
});
