import { prisma } from "@calcom/prisma";
import { ResourceBookingStatus } from "@calcom/prisma/enums";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { getNe26OrderRepository } from "../di/Ne26OrderRepository.container";
import { planExtension } from "../lib/bookingExtension";

/**
 * The cleaning gap is real slot rows, not a calculation, so a continuation
 * getting past it is a database question and has to be proved as one. The unit
 * tests cover the arithmetic; these cover the rows — that the meeting's gap is
 * never disturbed, that the room stays covered end to end, that the unique
 * index still refuses an outsider, and that cancelling the continuation leaves
 * the paid meeting exactly as it was.
 */
const orders = getNe26OrderRepository();
const STAMP = Date.now();
const SLUG = `test-ext-${STAMP}`;
const BUFFER_MINUTES = 15;

/** Event-local time on 17 Nov, in hours; 13.25 is 13:15. Istanbul is UTC+3. */
function at(localHour: number): Date {
  const utcMinutes = Math.round((localHour - 3) * 60);
  const pad = (n: number) => String(n).padStart(2, "0");
  return new Date(`2026-11-17T${pad(Math.floor(utcMinutes / 60))}:${pad(utcMinutes % 60)}:00.000Z`);
}
const OPEN = new Set<number>();
for (let ms = at(9).getTime(); ms < at(18).getTime(); ms += 15 * 60 * 1000) OPEN.add(ms);

let resourceId: number;
let userId: number;
const buyer = { email: `ext-${STAMP}@test.com`, name: "Exhibitor" };

/** The meeting being continued: 11:00–13:00, paid, with its gap reserved. */
async function paidParent() {
  const marks: Date[] = [];
  for (let ms = at(11).getTime(); ms < at(13).getTime(); ms += 15 * 60 * 1000) marks.push(new Date(ms));
  const order = await orders.createWithRooms({
    bookerUserId: userId,
    bookerEmail: buyer.email,
    bookerName: buyer.name,
    amountTotal: 54000,
    currency: "EUR",
    holdExpiresAt: new Date(Date.now() + 60 * 60 * 1000),
    rooms: [
      {
        resourceId,
        startTime: at(11),
        endTime: at(13),
        durationMinutes: 120,
        // Its own hours plus the quarter-hour of cleaning after them.
        slotStarts: [...marks, at(13)],
        amountTotal: 54000,
        addOns: [],
      },
    ],
  });
  await orders.confirmPaid(order?.uid as string, null);
  return prisma.resourceBooking.findFirstOrThrow({
    where: { orderUid: order?.uid },
    select: { uid: true, id: true, startTime: true, endTime: true },
  });
}

async function continueAfter(parent: { uid: string; startTime: Date; endTime: Date }, hours: 1 | 2 | 3 = 1) {
  const plan = planExtension({
    parent,
    direction: "after",
    durationHours: hours,
    bufferMinutes: BUFFER_MINUTES,
    openSlotMs: OPEN,
  });
  const order = await orders.createWithRooms({
    bookerUserId: userId,
    bookerEmail: buyer.email,
    bookerName: buyer.name,
    amountTotal: 30000,
    currency: "EUR",
    holdExpiresAt: plan.startTime,
    rooms: [
      {
        resourceId,
        startTime: plan.startTime,
        endTime: plan.endTime,
        durationMinutes: plan.durationMinutes,
        slotStarts: [...plan.slotStarts, ...plan.bufferSlots],
        extendsBookingUid: parent.uid,
        amountTotal: 30000,
        addOns: [],
      },
    ],
  });
  return { plan, order };
}

/** Quarter-hours held in the room, whoever holds them. */
async function heldMarks(): Promise<number[]> {
  const rows = await prisma.resourceSlot.findMany({
    where: { resourceId },
    select: { slotStart: true },
  });
  return rows.map((r) => r.slotStart.getTime()).sort();
}

describe("createWithRooms, continuing a booking", () => {
  beforeAll(async () => {
    const room = await prisma.resource.create({
      data: {
        name: "TEST Extension Room",
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
    const user = await prisma.user.create({
      data: { email: buyer.email, username: `ext-${STAMP}`, name: buyer.name },
      select: { id: true },
    });
    userId = user.id;
  });

  afterEach(async () => {
    if (resourceId === undefined) return;
    await prisma.resourceBooking.deleteMany({ where: { resourceId } });
    await prisma.ne26Order.deleteMany({ where: { bookerEmail: buyer.email } });
  });

  afterAll(async () => {
    // Guarded: when the setup itself fails, an unguarded cleanup throws on an
    // undefined id and buries the error that actually matters.
    if (resourceId !== undefined) await prisma.resource.deleteMany({ where: { id: resourceId } });
    if (userId !== undefined) await prisma.user.deleteMany({ where: { id: userId } });
  });

  it("is sold from the minute the meeting ended", async () => {
    const parent = await paidParent();
    const { order } = await continueAfter(parent);
    expect(order?.bookings).toHaveLength(1);
    expect(order?.bookings[0].startTime.toISOString()).toBe(at(13).toISOString());
    expect(order?.bookings[0].endTime.toISOString()).toBe(at(14).toISOString());
  });

  it("leaves the meeting's cleaning gap owned by the meeting", async () => {
    const parent = await paidParent();
    await continueAfter(parent);
    const gap = await prisma.resourceSlot.findFirstOrThrow({
      where: { resourceId, slotStart: at(13) },
      select: { bookingId: true },
    });
    expect(gap.bookingId).toBe(parent.id);
  });

  it("covers the room end to end, with nothing left for anyone else", async () => {
    const parent = await paidParent();
    await continueAfter(parent);
    // 11:00 through 14:00 inclusive: the meeting, its gap, the continuation and
    // the continuation's own gap, with no quarter-hour missing in between.
    const expected: number[] = [];
    for (let ms = at(11).getTime(); ms <= at(14).getTime(); ms += 15 * 60 * 1000) expected.push(ms);
    expect(await heldMarks()).toEqual(expected);
  });

  it("records what the continuation continues", async () => {
    const parent = await paidParent();
    const { order } = await continueAfter(parent);
    const written = await prisma.resourceBooking.findFirstOrThrow({
      where: { orderUid: order?.uid },
      select: { extendsBookingUid: true },
    });
    expect(written.extendsBookingUid).toBe(parent.uid);
  });

  it("cancelling it leaves the paid meeting exactly as it was", async () => {
    // This is why the meeting's gap is never claimed in the first place. Were
    // it released and handed over, this cancellation would leave a paid meeting
    // with no cleaning gap, and a stranger could book flush against it.
    const parent = await paidParent();
    const before = await heldMarks();
    const { order } = await continueAfter(parent);
    await orders.cancelPending(order?.uid as string);

    expect(await heldMarks()).toEqual(before);
    const still = await prisma.resourceBooking.findUniqueOrThrow({
      where: { uid: parent.uid },
      select: { status: true, endTime: true },
    });
    expect(still.status).toBe(ResourceBookingStatus.CONFIRMED);
    expect(still.endTime.toISOString()).toBe(at(13).toISOString());
  });

  it("is refused when somebody else already holds the hour", async () => {
    const parent = await paidParent();
    const outsider = await prisma.resourceBooking.create({
      data: {
        resourceId,
        startTime: at(13.25),
        endTime: at(14.25),
        durationMinutes: 60,
        bookerEmail: `outsider-${STAMP}@test.com`,
        bookerName: "Outsider",
        amountTotal: 30000,
        currency: "EUR",
        status: ResourceBookingStatus.CONFIRMED,
      },
      select: { id: true },
    });
    await prisma.resourceSlot.create({
      data: { resourceId, slotStart: at(13.25), bookingId: outsider.id },
    });

    await expect(continueAfter(parent)).rejects.toThrow();

    // And the meeting still has its gap: the refusal cost it nothing.
    const gap = await prisma.resourceSlot.count({
      where: { resourceId, slotStart: at(13), bookingId: parent.id },
    });
    expect(gap).toBe(1);
  });
});
