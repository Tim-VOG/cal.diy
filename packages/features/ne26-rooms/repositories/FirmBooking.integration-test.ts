import { prisma } from "@calcom/prisma";
import { ResourceBookingStatus } from "@calcom/prisma/enums";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { getNe26OrderRepository } from "../di/Ne26OrderRepository.container";
import { getResourceBookingRepository } from "../di/ResourceBookingRepository.container";

/**
 * A booking with no hold deadline is FIRM, not expired.
 *
 * An admin only makes one at the exhibitor's express request, so the room is
 * theirs and the money is owed whether or not they turn up. The whole of this
 * file exists because the opposite reading is silent and expensive: a firm
 * booking treated as a lapsed hold does not error — it simply stops holding
 * its room, disappears from the counter, and the hours go back on sale under
 * somebody who has already been invited to pay for them.
 */
const orders = getNe26OrderRepository();
const bookings = getResourceBookingRepository();
const STAMP = Date.now();
const SLUG = `test-firm-${STAMP}`;

/** The whole of 18 Nov in UTC, as a window for the day-shaped queries. */
const DAY_FROM = new Date("2026-11-18T00:00:00.000Z");
const DAY_TO = new Date("2026-11-19T00:00:00.000Z");

function at(localHour: number): Date {
  const utcMinutes = Math.round((localHour - 3) * 60);
  const pad = (n: number) => String(n).padStart(2, "0");
  return new Date(`2026-11-18T${pad(Math.floor(utcMinutes / 60))}:${pad(utcMinutes % 60)}:00.000Z`);
}

let resourceId: number;
const buyer = { email: `firm-${STAMP}@test.com`, name: "Exhibitor" };

/** A firm booking: PENDING, unpaid, and with no deadline of any kind. */
async function firmBooking() {
  const marks: Date[] = [];
  for (let ms = at(14).getTime(); ms < at(15).getTime(); ms += 15 * 60 * 1000) marks.push(new Date(ms));
  const order = await orders.createWithRooms({
    bookerUserId: null,
    bookerEmail: buyer.email,
    bookerName: buyer.name,
    amountTotal: 30000,
    currency: "EUR",
    holdExpiresAt: null,
    rooms: [
      {
        resourceId,
        startTime: at(14),
        endTime: at(15),
        durationMinutes: 60,
        slotStarts: marks,
        amountTotal: 30000,
        addOns: [],
      },
    ],
  });
  return order;
}

describe("a booking with no hold deadline", () => {
  beforeAll(async () => {
    const room = await prisma.resource.create({
      data: {
        name: "TEST Firm Room",
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
  });

  afterEach(async () => {
    if (resourceId === undefined) return;
    await prisma.resourceBooking.deleteMany({ where: { resourceId } });
    await prisma.ne26Order.deleteMany({ where: { bookerEmail: buyer.email } });
  });

  afterAll(async () => {
    if (resourceId !== undefined) await prisma.resource.deleteMany({ where: { id: resourceId } });
  });

  it("still holds its slots", async () => {
    await firmBooking();
    const taken = await bookings.findActiveSlotStarts(resourceId, new Date());
    expect(taken.map((d) => d.toISOString())).toContain(at(14).toISOString());
  });

  it("is visible at the welcome desk", async () => {
    await firmBooking();
    const rows = await bookings.findForDesk(DAY_FROM, DAY_TO, new Date());
    expect(rows.some((r) => r.bookerEmail === buyer.email)).toBe(true);
  });

  it("is visible on the planning board", async () => {
    await firmBooking();
    const rows = await bookings.findForPlanning(DAY_FROM, DAY_TO, new Date());
    expect(rows.some((r) => r.bookerEmail === buyer.email)).toBe(true);
  });

  it("can be found by the desk's search", async () => {
    await firmBooking();
    const rows = await bookings.searchForDesk(buyer.name);
    expect(rows.some((r) => r.bookerEmail === buyer.email)).toBe(true);
  });

  it("counts as the exhibitor occupying that day", async () => {
    await firmBooking();
    const occupied = await orders.findOccupiedDaysForUser(
      { userId: null, email: buyer.email },
      new Date()
    );
    expect(occupied).toHaveLength(1);
  });

  it("survives the sweeper that frees abandoned holds", async () => {
    // The one that would have cost two paid-for hours: the sweeper matches a
    // deadline in the past, and NULL is not in the past.
    const order = await firmBooking();
    await bookings.deleteExpiredHolds(new Date(Date.now() + 365 * 24 * 60 * 60 * 1000));
    const still = await prisma.resourceBooking.count({ where: { orderUid: order?.uid } });
    expect(still).toBe(1);
  });

  it("is refused to anybody else, by the index", async () => {
    await firmBooking();
    await expect(
      orders.createWithRooms({
        bookerUserId: null,
        bookerEmail: `other-${STAMP}@test.com`,
        bookerName: "Other",
        amountTotal: 30000,
        currency: "EUR",
        holdExpiresAt: new Date(Date.now() + 35 * 60 * 1000),
        rooms: [
          {
            resourceId,
            startTime: at(14),
            endTime: at(15),
            durationMinutes: 60,
            slotStarts: [at(14)],
            amountTotal: 30000,
            addOns: [],
          },
        ],
      })
    ).rejects.toThrow();
    await prisma.ne26Order.deleteMany({ where: { bookerEmail: `other-${STAMP}@test.com` } });
  });

  it("is left alone by the hold reminders — it has no deadline to warn about", async () => {
    await firmBooking();
    const soon = await orders.findHoldsExpiringSoon(new Date(), new Date(Date.now() + 86_400_000));
    expect(soon.some((h) => h.bookerEmail === buyer.email)).toBe(false);
  });

  it("still becomes a normal paid booking", async () => {
    const order = await firmBooking();
    await orders.confirmPaid(order?.uid as string, "pi_firm_test");
    const paid = await prisma.resourceBooking.findFirstOrThrow({
      where: { orderUid: order?.uid },
      select: { status: true, holdExpiresAt: true },
    });
    expect(paid.status).toBe(ResourceBookingStatus.CONFIRMED);
    expect(paid.holdExpiresAt).toBeNull();
  });
});
