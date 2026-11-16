import { prisma } from "@calcom/prisma";
import { ResourceBookingStatus } from "@calcom/prisma/enums";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { getNe26OrderRepository } from "../di/Ne26OrderRepository.container";
import { moveBooking } from "./MoveBookingService";

/**
 * Moving a booking is the one operation that rewrites where a paid meeting
 * sits. The tests that matter are the refusals: a move that half-happens, or
 * one that slides a meeting away from the extra time sold with it, costs an
 * exhibitor the room they paid for.
 */
const orders = getNe26OrderRepository();
const STAMP = Date.now();
const SLUG = `test-move-${STAMP}`;

/** Event-local time on 18 Nov, in hours; 13.25 is 13:15. Istanbul is UTC+3. */
function at(localHour: number): Date {
  const utcMinutes = Math.round((localHour - 3) * 60);
  const pad = (n: number) => String(n).padStart(2, "0");
  return new Date(`2026-11-18T${pad(Math.floor(utcMinutes / 60))}:${pad(utcMinutes % 60)}:00.000Z`);
}

let resourceId: number;
const buyer = { email: `move-${STAMP}@test.com`, name: "Exhibitor" };

async function paidBookingAt(hour: number, who = buyer.email) {
  const marks: Date[] = [];
  for (let ms = at(hour).getTime(); ms < at(hour + 1).getTime(); ms += 15 * 60 * 1000) {
    marks.push(new Date(ms));
  }
  const order = await orders.createWithRooms({
    bookerUserId: null,
    bookerEmail: who,
    bookerName: buyer.name,
    amountTotal: 30000,
    currency: "EUR",
    holdExpiresAt: new Date(Date.now() + 3_600_000),
    rooms: [
      {
        resourceId,
        startTime: at(hour),
        endTime: at(hour + 1),
        durationMinutes: 60,
        slotStarts: marks,
        amountTotal: 30000,
        addOns: [],
      },
    ],
  });
  await orders.confirmPaid(order?.uid as string, null);
  return prisma.resourceBooking.findFirstOrThrow({
    where: { orderUid: order?.uid },
    select: { uid: true, id: true },
  });
}

async function marksOf(bookingId: number): Promise<string[]> {
  const rows = await prisma.resourceSlot.findMany({
    where: { bookingId },
    select: { slotStart: true },
    orderBy: { slotStart: "asc" },
  });
  return rows.map((r) => r.slotStart.toISOString());
}

describe("moveBooking", () => {
  beforeAll(async () => {
    const room = await prisma.resource.create({
      data: {
        name: "TEST Move Room",
        slug: SLUG,
        category: "ENTRY",
        capacity: 6,
        surface: 18,
        price1h: 30000,
        price2h: 54000,
        price3h: 76500,
      },
      select: { id: true },
    });
    resourceId = room.id;
    await prisma.ne26RoomSettings.upsert({
      where: { id: 1 },
      update: { bufferMinutes: 0 },
      create: { id: 1, bufferMinutes: 0 },
    });
  });

  afterEach(async () => {
    if (resourceId === undefined) return;
    await prisma.resourceBooking.deleteMany({ where: { resourceId } });
    await prisma.ne26Order.deleteMany({ where: { bookerEmail: { contains: `move-${STAMP}` } } });
  });

  afterAll(async () => {
    if (resourceId !== undefined) await prisma.resource.deleteMany({ where: { id: resourceId } });
  });

  it("puts the booking at the new time", async () => {
    const booking = await paidBookingAt(11);
    const moved = await moveBooking({ bookingUid: booking.uid, newStartUtc: at(14) });

    expect(moved.toLabel).toContain("14:00");
    const row = await prisma.resourceBooking.findUniqueOrThrow({
      where: { uid: booking.uid },
      select: { startTime: true, endTime: true, amountTotal: true, status: true },
    });
    expect(row.startTime.toISOString()).toBe(at(14).toISOString());
    expect(row.endTime.toISOString()).toBe(at(15).toISOString());
    // Same room, same length: nothing about the money may have moved.
    expect(row.amountTotal).toBe(30000);
    expect(row.status).toBe(ResourceBookingStatus.CONFIRMED);
  });

  it("takes its quarter-hours with it and leaves none behind", async () => {
    const booking = await paidBookingAt(11);
    await moveBooking({ bookingUid: booking.uid, newStartUtc: at(14) });

    expect(await marksOf(booking.id)).toEqual([
      at(14).toISOString(),
      at(14.25).toISOString(),
      at(14.5).toISOString(),
      at(14.75).toISOString(),
    ]);
    // The hour it left is free again, for anybody.
    const stillAtEleven = await prisma.resourceSlot.count({
      where: { resourceId, slotStart: at(11) },
    });
    expect(stillAtEleven).toBe(0);
  });

  it("is refused when somebody else holds the target, and does not move", async () => {
    const booking = await paidBookingAt(11);
    await paidBookingAt(14, `other-move-${STAMP}@test.com`);

    await expect(moveBooking({ bookingUid: booking.uid, newStartUtc: at(14) })).rejects.toThrow();

    // The rollback is the point: a half-done move would have left the meeting
    // holding nothing at all.
    const row = await prisma.resourceBooking.findUniqueOrThrow({
      where: { uid: booking.uid },
      select: { startTime: true },
    });
    expect(row.startTime.toISOString()).toBe(at(11).toISOString());
    expect(await marksOf(booking.id)).toHaveLength(4);
    await prisma.ne26Order.deleteMany({ where: { bookerEmail: `other-move-${STAMP}@test.com` } });
  });

  it("refuses to move a meeting that has extra time sold onto it", async () => {
    const booking = await paidBookingAt(11);
    await prisma.resourceBooking.create({
      data: {
        resourceId,
        startTime: at(12),
        endTime: at(13),
        durationMinutes: 60,
        bookerEmail: buyer.email,
        bookerName: buyer.name,
        amountTotal: 30000,
        currency: "EUR",
        status: ResourceBookingStatus.PENDING,
        extendsBookingUid: booking.uid,
      },
    });

    await expect(moveBooking({ bookingUid: booking.uid, newStartUtc: at(15) })).rejects.toThrow(
      /extra time/i
    );
  });

  it("refuses to move extra time away from the meeting it continues", async () => {
    const booking = await paidBookingAt(11);
    const extra = await prisma.resourceBooking.create({
      data: {
        resourceId,
        startTime: at(12),
        endTime: at(13),
        durationMinutes: 60,
        bookerEmail: buyer.email,
        bookerName: buyer.name,
        amountTotal: 30000,
        currency: "EUR",
        status: ResourceBookingStatus.CONFIRMED,
        extendsBookingUid: booking.uid,
      },
      select: { uid: true },
    });

    await expect(moveBooking({ bookingUid: extra.uid, newStartUtc: at(15) })).rejects.toThrow(
      /attached to another meeting/i
    );
  });

  it("refuses a time outside the opening hours", async () => {
    const booking = await paidBookingAt(11);
    await expect(
      moveBooking({ bookingUid: booking.uid, newStartUtc: at(23) })
    ).rejects.toThrow(/opening hours/i);
  });

  it("refuses to move a booking onto itself", async () => {
    const booking = await paidBookingAt(11);
    await expect(moveBooking({ bookingUid: booking.uid, newStartUtc: at(11) })).rejects.toThrow(
      /already is/i
    );
  });
});
