import { prisma } from "@calcom/prisma";
import { ResourceBookingStatus } from "@calcom/prisma/enums";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { planExtension } from "../lib/bookingExtension";
import { getNe26OrderRepository } from "../di/Ne26OrderRepository.container";

/**
 * The cleaning gap is real slot rows, not a calculation, so handing it from one
 * booking to its continuation is a database operation and has to be proved as
 * one. The unit tests for planExtension prove the arithmetic; these prove that
 * the rows end up where the arithmetic said, that the paid meeting is untouched
 * on the way, and that the no-double-booking index still refuses an outsider.
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
  const bufferMarks = [at(13)];

  const order = await orders.createWithRooms({
    bookerUserId: userId,
    bookerEmail: buyer.email,
    bookerName: buyer.name,
    amountTotal: 65000,
    currency: "EUR",
    holdExpiresAt: new Date(Date.now() + 60 * 60 * 1000),
    rooms: [
      {
        resourceId,
        startTime: at(11),
        endTime: at(13),
        durationMinutes: 120,
        slotStarts: [...marks, ...bufferMarks],
        amountTotal: 65000,
        addOns: [],
      },
    ],
  });
  await orders.confirmPaid(order!.uid, null);
  const booking = await prisma.resourceBooking.findFirstOrThrow({
    where: { orderUid: order!.uid },
    select: { uid: true, id: true, startTime: true, endTime: true },
  });
  return booking;
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

  it("lets the continuation take the hour the gap was sitting on", async () => {
    const parent = await paidParent();
    const plan = planExtension({
      parent,
      direction: "after",
      durationHours: 1,
      bufferMinutes: BUFFER_MINUTES,
      openSlotMs: OPEN,
    });

    const order = await orders.createWithRooms({
      bookerUserId: userId,
      bookerEmail: buyer.email,
      bookerName: buyer.name,
      amountTotal: 30000,
      currency: "EUR",
      holdExpiresAt: at(11),
      releaseBufferAfter: { bookingUid: parent.uid, from: plan.releasesParentBufferFrom as Date },
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

    expect(order?.bookings).toHaveLength(1);
    expect(order?.bookings[0].startTime.toISOString()).toBe(at(13).toISOString());
  });

  it("records what the continuation continues", async () => {
    const parent = await paidParent();
    const plan = planExtension({
      parent,
      direction: "after",
      durationHours: 1,
      bufferMinutes: BUFFER_MINUTES,
      openSlotMs: OPEN,
    });
    const order = await orders.createWithRooms({
      bookerUserId: userId,
      bookerEmail: buyer.email,
      bookerName: buyer.name,
      amountTotal: 30000,
      currency: "EUR",
      holdExpiresAt: at(11),
      releaseBufferAfter: { bookingUid: parent.uid, from: plan.releasesParentBufferFrom as Date },
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
    const written = await prisma.resourceBooking.findFirstOrThrow({
      where: { orderUid: order!.uid },
      select: { extendsBookingUid: true },
    });
    expect(written.extendsBookingUid).toBe(parent.uid);
  });

  it("never touches the paid meeting's own hours", async () => {
    const parent = await paidParent();
    const before = await prisma.resourceSlot.count({
      where: { bookingId: parent.id, slotStart: { lt: parent.endTime } },
    });
    const plan = planExtension({
      parent,
      direction: "after",
      durationHours: 1,
      bufferMinutes: BUFFER_MINUTES,
      openSlotMs: OPEN,
    });
    await orders.createWithRooms({
      bookerUserId: userId,
      bookerEmail: buyer.email,
      bookerName: buyer.name,
      amountTotal: 30000,
      currency: "EUR",
      holdExpiresAt: at(11),
      releaseBufferAfter: { bookingUid: parent.uid, from: plan.releasesParentBufferFrom as Date },
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

    const after = await prisma.resourceSlot.count({
      where: { bookingId: parent.id, slotStart: { lt: parent.endTime } },
    });
    expect(after).toBe(before);
    // And the meeting itself is still paid and whole.
    const still = await prisma.resourceBooking.findUniqueOrThrow({
      where: { uid: parent.uid },
      select: { status: true, startTime: true, endTime: true },
    });
    expect(still.status).toBe(ResourceBookingStatus.CONFIRMED);
    expect(still.endTime.toISOString()).toBe(at(13).toISOString());
  });

  it("still refuses an outsider holding the hour, and leaves the gap in place", async () => {
    const parent = await paidParent();
    // Somebody else books 13:15, inside the hour the continuation wants.
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

    const plan = planExtension({
      parent,
      direction: "after",
      durationHours: 1,
      bufferMinutes: BUFFER_MINUTES,
      openSlotMs: OPEN,
    });
    await expect(
      orders.createWithRooms({
        bookerUserId: userId,
        bookerEmail: buyer.email,
        bookerName: buyer.name,
        amountTotal: 30000,
        currency: "EUR",
        holdExpiresAt: at(11),
        releaseBufferAfter: { bookingUid: parent.uid, from: plan.releasesParentBufferFrom as Date },
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
      })
    ).rejects.toThrow();

    // The rollback matters more than the refusal: a released gap that is not
    // replaced would leave the paid meeting able to be booked flush against.
    const gap = await prisma.resourceSlot.count({
      where: { bookingId: parent.id, slotStart: { gte: parent.endTime } },
    });
    expect(gap).toBe(1);
  });
});
