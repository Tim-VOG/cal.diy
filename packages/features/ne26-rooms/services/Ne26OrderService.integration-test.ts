import { ErrorCode } from "@calcom/lib/errorCodes";
import { ErrorWithCode } from "@calcom/lib/errors";
import { prisma } from "@calcom/prisma";
import { ResourceBookingStatus } from "@calcom/prisma/enums";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { getNe26OrderRepository } from "../di/Ne26OrderRepository.container";
import { Ne26OrderService } from "./Ne26OrderService";

const service = new Ne26OrderService();
const orders = getNe26OrderRepository();
const STAMP = Date.now();

/** Event-local hour on the given day; Istanbul is UTC+3 all year. */
function at(date: string, localHour: number): Date {
  return new Date(`${date}T${String(localHour - 3).padStart(2, "0")}:00:00.000Z`);
}
const TUE = "2026-11-17";
const WED = "2026-11-18";
const THU = "2026-11-19";

const SLUG_A = `test-order-a-${STAMP}`;
const SLUG_B = `test-order-b-${STAMP}`;
// Test-local add-ons: the shared seeded catalogue is admin-editable, so pinning
// totals against it would make this suite depend on production prices.
const CATERING_SLUG = `test-order-catering-${STAMP}`;
const SCREEN_SLUG = `test-order-screen-${STAMP}`;
const LUNCH_SLUG = `test-order-lunch-${STAMP}`;

let roomA: number;
let roomB: number;
let userId: number;
const buyer = () => ({ userId, email: `order-${STAMP}@test.com`, name: "Exhibitor" });
const walkIn = { userId: null, email: `walkin-${STAMP}@test.com`, name: "Walk-in" };

function room(slug: string, date: string, hour: number, durationHours: 1 | 2 | 3 = 1) {
  return { slug, startUtc: at(date, hour), durationHours };
}

describe("Ne26OrderService.createOrder", () => {
  beforeAll(async () => {
    const make = (name: string, slug: string) =>
      prisma.resource.create({
        data: {
          name,
          slug,
          category: "ENTRY",
          capacity: 6,
          surface: 18,
          price1h: 35000,
          price2h: 65000,
          price3h: 90000,
        },
        select: { id: true },
      });
    const [a, b] = await Promise.all([make("TEST Order Room A", SLUG_A), make("TEST Order Room B", SLUG_B)]);
    roomA = a.id;
    roomB = b.id;

    const user = await prisma.user.create({
      data: { email: `order-${STAMP}@test.com`, username: `order-${STAMP}`, name: "Exhibitor" },
      select: { id: true },
    });
    userId = user.id;

    await prisma.addOn.createMany({
      data: [
        { name: "TEST Catering", slug: CATERING_SLUG, price: 3500, priceType: "PER_PERSON" },
        { name: "TEST Screen", slug: SCREEN_SLUG, price: 5000, priceType: "FLAT" },
        // Served 11:00-14:00 event-local, like the real catering line.
        {
          name: "TEST Lunch",
          slug: LUNCH_SLUG,
          price: 3500,
          priceType: "PER_PERSON",
          availableFromMinute: 660,
          availableToMinute: 840,
        },
      ],
    });

    // Pin the turnover buffer so the expected slot count is deterministic: it is
    // a shared admin setting, and whatever another suite last wrote would
    // otherwise decide it.
    await prisma.ne26RoomSettings.upsert({
      where: { id: 1 },
      update: { bufferMinutes: 0 },
      create: { id: 1, bufferMinutes: 0 },
    });
  });

  afterEach(async () => {
    await prisma.ne26Order.deleteMany({
      where: {
        OR: [
          { bookerEmail: { in: [buyer().email, walkIn.email] } },
          { bookerEmail: { endsWith: `-${STAMP}@test.com` } },
        ],
      },
    });
    await prisma.resourceBooking.deleteMany({ where: { resourceId: { in: [roomA, roomB] } } });
  });

  afterAll(async () => {
    await prisma.resource.deleteMany({ where: { id: { in: [roomA, roomB] } } });
    await prisma.addOn.deleteMany({ where: { slug: { in: [CATERING_SLUG, SCREEN_SLUG, LUNCH_SLUG] } } });
    await prisma.user.delete({ where: { id: userId } });
  });

  it("creates a PENDING order with a hold and the correct total (room + add-ons)", async () => {
    const { order } = await service.createOrder({
      buyer: buyer(),
      rooms: [
        {
          ...room(SLUG_A, WED, 9, 2),
          addOns: [
            { slug: CATERING_SLUG, quantity: 6 }, // PER_PERSON 3500 * 6 = 21000
            { slug: SCREEN_SLUG, quantity: 1 }, // FLAT 5000
          ],
        },
      ],
    });

    // 65000 (2h) + 21000 + 5000
    expect(order.amountTotal).toBe(91000);
    expect(order.status).toBe(ResourceBookingStatus.PENDING);
    expect((order.holdExpiresAt as Date).getTime()).toBeGreaterThan(Date.now());

    const booking = await prisma.resourceBooking.findUniqueOrThrow({
      where: { uid: order.bookings[0].uid },
      select: { amountTotal: true, slots: true, addOns: true, bookerUserId: true },
    });
    expect(booking.bookerUserId).toBe(userId);
    // 2h on the 15-minute grid = 8 slots (the buffer is pinned to 0 above).
    expect(booking.slots).toHaveLength(8);
    expect(booking.addOns).toHaveLength(2);
  });

  it("rejects a start time outside the event opening hours", async () => {
    await expect(
      service.createOrder({ buyer: buyer(), rooms: [room(SLUG_A, WED, 7)] }) // before opening
    ).rejects.toMatchObject({ code: ErrorCode.BadRequest });
  });

  it("rejects an unknown add-on", async () => {
    await expect(
      service.createOrder({
        buyer: buyer(),
        rooms: [{ ...room(SLUG_A, WED, 9), addOns: [{ slug: "does-not-exist", quantity: 1 }] }],
      })
    ).rejects.toBeInstanceOf(ErrorWithCode);
  });

  it("holds the slots long enough for Stripe Checkout to accept the session", async () => {
    // Stripe refuses a Checkout session expiring in under 30 minutes, and the
    // session must expire with the hold — so the hold can never be shorter.
    const before = Date.now();
    const { order } = await service.createOrder({ buyer: buyer(), rooms: [room(SLUG_A, WED, 9)] });
    expect(((order.holdExpiresAt as Date).getTime() - before) / 60000).toBeGreaterThanOrEqual(30);
  });

  it("refuses the same room twice at overlapping times in one basket", async () => {
    // Otherwise this surfaces only as a slot-index clash — "somebody took it",
    // naming nobody, to the person who put it in their own basket twice.
    await expect(
      service.createOrder({
        buyer: buyer(),
        rooms: [room(SLUG_A, WED, 9, 2), room(SLUG_A, WED, 10)],
      })
    ).rejects.toThrow(/appears twice/i);
  });

  it("holds several rooms under one order, with one total", async () => {
    const { order } = await service.createOrder({
      buyer: buyer(),
      rooms: [room(SLUG_A, TUE, 14), room(SLUG_B, WED, 10, 2)],
    });

    expect(order.bookings).toHaveLength(2);
    expect(order.amountTotal).toBe(35000 + 65000);
    expect(order.status).toBe(ResourceBookingStatus.PENDING);
  });

  it("releases every room when one of them is already taken", async () => {
    // The point of holding them in one transaction: a clash on the second must
    // not leave the first locked for 35 minutes on an order that never existed.
    const first = await service.createOrder({ buyer: buyer(), rooms: [room(SLUG_B, WED, 10)] });
    expect(first.order.bookings).toHaveLength(1);

    const other = await prisma.user.create({
      data: { email: `rival-${STAMP}@test.com`, username: `rival-${STAMP}`, name: "Rival" },
      select: { id: true },
    });
    try {
      await expect(
        service.createOrder({
          buyer: { userId: other.id, email: `rival-${STAMP}@test.com`, name: "Rival" },
          rooms: [room(SLUG_A, TUE, 14), room(SLUG_B, WED, 10)], // the second is taken
        })
      ).rejects.toMatchObject({ code: ErrorCode.BookingConflict });

      // Room A must be free: the rival's order rolled back entirely.
      expect(await prisma.resourceBooking.count({ where: { resourceId: roomA } })).toBe(0);
    } finally {
      await prisma.ne26Order.deleteMany({ where: { bookerUserId: other.id } });
      await prisma.user.delete({ where: { id: other.id } });
    }
  });

  it("confirms a paid order covering several rooms", async () => {
    // ResourceBooking.stripePaymentId is unique, so writing one payment id onto
    // every room raised P2002 and rolled the confirmation back: a paid order
    // stayed PENDING and its hold quietly lapsed. The payment belongs to the
    // order; the rooms only carry the status.
    const { order } = await service.createOrder({
      buyer: buyer(),
      rooms: [room(SLUG_A, TUE, 14), room(SLUG_B, WED, 10)],
    });

    expect(await orders.confirmPaid(order.uid, `pi_multi_${STAMP}`)).toBe(true);
    // Idempotent: a replayed Stripe delivery must not confirm twice.
    expect(await orders.confirmPaid(order.uid, `pi_other_${STAMP}`)).toBe(false);

    const confirmed = await orders.findByUid(order.uid);
    expect(confirmed?.status).toBe(ResourceBookingStatus.CONFIRMED);
    expect(confirmed?.stripePaymentId).toBe(`pi_multi_${STAMP}`);
    const rows = await prisma.resourceBooking.findMany({
      where: { orderUid: order.uid },
      select: { status: true, holdExpiresAt: true },
    });
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.status === ResourceBookingStatus.CONFIRMED)).toBe(true);
    // No hold left to expire underneath a paid order.
    expect(rows.every((r) => r.holdExpiresAt === null)).toBe(true);
  });

  describe("an add-on with serving hours", () => {
    // The feedback that started this: booking at 09:00 still offered lunch.
    it("refuses lunch on an early booking, naming the hours", async () => {
      await expect(
        service.createOrder({
          buyer: buyer(),
          rooms: [{ ...room(SLUG_A, WED, 9), addOns: [{ slug: LUNCH_SLUG, quantity: 4 }] }],
        })
      ).rejects.toThrow(/only served between 11:00-14:00/);
    });

    it("sells it to a booking that runs into the serving hours", async () => {
      // 10:00-12:00 reaches lunch. Refusing it would lose a legitimate sale.
      const { order } = await service.createOrder({
        buyer: buyer(),
        rooms: [{ ...room(SLUG_A, WED, 10, 2), addOns: [{ slug: LUNCH_SLUG, quantity: 4 }] }],
      });
      expect(order.amountTotal).toBe(65000 + 14000);
    });

    it("still sells an add-on that has no serving hours", async () => {
      const { order } = await service.createOrder({
        buyer: buyer(),
        rooms: [{ ...room(SLUG_A, WED, 9), addOns: [{ slug: SCREEN_SLUG, quantity: 1 }] }],
      });
      expect(order.amountTotal).toBe(35000 + 5000);
    });
  });

  describe("mid-event, with the booking URL still live", () => {
    // Wednesday 18 Nov, 11:00 Istanbul: the state the hostess tablet and any
    // broadcast link are in during the event. Only Date is faked, so Prisma's
    // internal timers keep working.
    beforeAll(() => {
      vi.useFakeTimers({ toFake: ["Date"], now: at(WED, 11) });
    });
    afterAll(() => {
      vi.useRealTimers();
    });

    it("rejects a slot that has already started, even though it is within opening hours", async () => {
      await expect(
        service.createOrder({ buyer: buyer(), rooms: [room(SLUG_A, WED, 9)] }) // two hours ago
      ).rejects.toMatchObject({ code: ErrorCode.BadRequest });
    });

    it("rejects a slot from an earlier event day", async () => {
      await expect(
        service.createOrder({ buyer: buyer(), rooms: [room(SLUG_A, TUE, 14)] }) // yesterday
      ).rejects.toMatchObject({ code: ErrorCode.BadRequest });
    });

    it("still sells a slot later the same day", async () => {
      const { order } = await service.createOrder({
        buyer: buyer(),
        rooms: [room(SLUG_A, WED, 13)], // two hours out
      });
      expect(order.status).toBe(ResourceBookingStatus.PENDING);
    });
  });

  describe("holds about to lapse", () => {
    /** Move an order's hold to a given number of minutes from now. */
    async function holdIn(minutes: number) {
      const { order } = await service.createOrder({ buyer: buyer(), rooms: [room(SLUG_A, WED, 9)] });
      const at = new Date(Date.now() + minutes * 60_000);
      await prisma.ne26Order.update({ where: { uid: order.uid }, data: { holdExpiresAt: at } });
      return order.uid;
    }

    it("finds a hold inside the warning window", async () => {
      const uid = await holdIn(10);
      const now = new Date();
      const due = await orders.findHoldsExpiringSoon(now, new Date(now.getTime() + 15 * 60_000));
      expect(due.map((o) => o.uid)).toContain(uid);
    });

    it("ignores one with plenty of time left", async () => {
      const uid = await holdIn(30);
      const now = new Date();
      const due = await orders.findHoldsExpiringSoon(now, new Date(now.getTime() + 15 * 60_000));
      expect(due.map((o) => o.uid)).not.toContain(uid);
    });

    it("ignores one that has already lapsed", async () => {
      // "10 minutes left" about a room that is back on sale is worse than silence.
      const uid = await holdIn(-5);
      const now = new Date();
      const due = await orders.findHoldsExpiringSoon(now, new Date(now.getTime() + 15 * 60_000));
      expect(due.map((o) => o.uid)).not.toContain(uid);
    });

    it("can be claimed once and only once", async () => {
      // Two overlapping cron runs must not both mail the same buyer.
      const uid = await holdIn(10);
      const now = new Date();
      expect(await orders.claimHoldReminder(uid, now)).toBe(true);
      expect(await orders.claimHoldReminder(uid, now)).toBe(false);
    });

    it("drops out of the window once claimed", async () => {
      const uid = await holdIn(10);
      await orders.claimHoldReminder(uid, new Date());
      const now = new Date();
      const due = await orders.findHoldsExpiringSoon(now, new Date(now.getTime() + 15 * 60_000));
      expect(due.map((o) => o.uid)).not.toContain(uid);
    });

    it("never claims an order that has been paid", async () => {
      const uid = await holdIn(10);
      await orders.confirmPaid(uid, `pi_reminder_${STAMP}`);
      expect(await orders.claimHoldReminder(uid, new Date())).toBe(false);
    });
  });

  describe("holding without paying", () => {
    // The deliberate step between browsing and paying. It must take the rooms
    // off sale exactly as a checkout does, and obey every rule a sale obeys —
    // otherwise it is a way to park inventory that could never be bought.
    it("takes the rooms off sale for the same window a checkout gets", async () => {
      const before = Date.now();
      const { order } = await service.createOrder({
        buyer: buyer(),
        rooms: [room(SLUG_A, WED, 9)],
      });

      expect(order.status).toBe(ResourceBookingStatus.PENDING);
      expect(((order.holdExpiresAt as Date).getTime() - before) / 60000).toBeGreaterThanOrEqual(30);
      // The slots are really taken: a rival cannot book the same room.
      const rival = await prisma.user.create({
        data: { email: `rival2-${STAMP}@test.com`, username: `rival2-${STAMP}`, name: "Rival" },
        select: { id: true },
      });
      try {
        await expect(
          service.createOrder({
            buyer: { userId: rival.id, email: `rival2-${STAMP}@test.com`, name: "Rival" },
            rooms: [room(SLUG_A, WED, 9)],
          })
        ).rejects.toMatchObject({ code: ErrorCode.BookingConflict });
      } finally {
        await prisma.ne26Order.deleteMany({ where: { bookerUserId: rival.id } });
        await prisma.user.delete({ where: { id: rival.id } });
      }
    });

    it("still leaves the exhibitor exactly one room that day", async () => {
      // Changing your mind is not the same as taking a second room: the second
      // basket replaces the hold rather than adding to it, so the rule holds
      // without the exhibitor being locked out of their own purchase.
      await service.createOrder({ buyer: buyer(), rooms: [room(SLUG_A, WED, 9)] });
      await service.createOrder({ buyer: buyer(), rooms: [room(SLUG_B, WED, 11)] });

      const heldThatDay = await prisma.resourceBooking.count({
        where: {
          bookerUserId: userId,
          status: ResourceBookingStatus.PENDING,
          // The whole event-local day; Istanbul is UTC+3 all year.
          startTime: {
            gte: new Date(`${WED}T00:00:00.000+03:00`),
            lt: new Date(`${WED}T24:00:00.000+03:00`),
          },
        },
      });
      expect(heldThatDay).toBe(1);
    });

    it("frees the rooms once the hold lapses", async () => {
      const { order } = await service.createOrder({ buyer: buyer(), rooms: [room(SLUG_A, WED, 9)] });
      // What the buyer is told: unpaid by then and they go back on sale.
      const expired = new Date(Date.now() - 60_000);
      await prisma.ne26Order.update({ where: { uid: order.uid }, data: { holdExpiresAt: expired } });
      await prisma.resourceBooking.updateMany({
        where: { orderUid: order.uid },
        data: { holdExpiresAt: expired },
      });

      const other = await prisma.user.create({
        data: { email: `rival3-${STAMP}@test.com`, username: `rival3-${STAMP}`, name: "Rival" },
        select: { id: true },
      });
      try {
        const { order: taken } = await service.createOrder({
          buyer: { userId: other.id, email: `rival3-${STAMP}@test.com`, name: "Rival" },
          rooms: [room(SLUG_A, WED, 9)],
        });
        expect(taken.bookings).toHaveLength(1);
      } finally {
        await prisma.ne26Order.deleteMany({ where: { bookerUserId: other.id } });
        await prisma.user.delete({ where: { id: other.id } });
      }
    });
  });

  describe("one room per exhibitor per day", () => {
    it("refuses a second room on a day already paid for", async () => {
      const { order } = await service.createOrder({ buyer: buyer(), rooms: [room(SLUG_A, TUE, 14)] });
      await orders.confirmPaid(order.uid, null);

      await expect(
        service.createOrder({ buyer: buyer(), rooms: [room(SLUG_B, TUE, 16)] })
      ).rejects.toMatchObject({ code: ErrorCode.BadRequest });
    });

    it("refuses two rooms on the same day inside one order", async () => {
      // Otherwise the rule is bypassed simply by putting both in one basket.
      await expect(
        service.createOrder({
          buyer: buyer(),
          rooms: [room(SLUG_A, TUE, 14), room(SLUG_B, TUE, 16)],
        })
      ).rejects.toMatchObject({ code: ErrorCode.BadRequest });
    });

    it("allows one room on each of the three event days", async () => {
      const { order } = await service.createOrder({
        buyer: buyer(),
        rooms: [room(SLUG_A, TUE, 14), room(SLUG_B, WED, 10), room(SLUG_A, THU, 10)],
      });
      expect(order.bookings).toHaveLength(3);
    });


    it("ignores a hold that has lapsed", async () => {
      const { order } = await service.createOrder({ buyer: buyer(), rooms: [room(SLUG_A, TUE, 14)] });
      // Age it out: it protects nothing any more, so it must not block the day.
      const expired = new Date(Date.now() - 60_000);
      await prisma.ne26Order.update({ where: { uid: order.uid }, data: { holdExpiresAt: expired } });
      await prisma.resourceBooking.updateMany({
        where: { orderUid: order.uid },
        data: { holdExpiresAt: expired },
      });

      await expect(
        service.createOrder({ buyer: buyer(), rooms: [room(SLUG_B, TUE, 16)] })
      ).resolves.toMatchObject({ order: { status: ResourceBookingStatus.PENDING } });
    });

    it("explains the rule rather than just refusing", async () => {
      const { order } = await service.createOrder({ buyer: buyer(), rooms: [room(SLUG_A, TUE, 14)] });
      await orders.confirmPaid(order.uid, null);
      await expect(service.createOrder({ buyer: buyer(), rooms: [room(SLUG_B, TUE, 16)] })).rejects.toThrow(
        /one meeting room per day/i
      );
    });

    it("holds at the counter too, matched on the exhibitor's email", async () => {
      // The rule is per EXHIBITOR, not per account. A walk-in has no userId, so
      // the email the desk collects is what identifies them — otherwise the
      // counter is a way round the rule.
      const { order } = await service.createOrder({ buyer: walkIn, rooms: [room(SLUG_A, TUE, 14)] });
      await orders.confirmPaid(order.uid, null);

      await expect(
        service.createOrder({ buyer: walkIn, rooms: [room(SLUG_B, TUE, 16)] })
      ).rejects.toThrow(/one meeting room per day/i);
    });

    it("does not confuse two different walk-ins", async () => {
      const theirs = await service.createOrder({ buyer: walkIn, rooms: [room(SLUG_A, TUE, 14)] });
      await orders.confirmPaid(theirs.order.uid, null);

      // A different exhibitor, same day: perfectly normal, nine rooms exist.
      const other = { userId: null, email: `walkin2-${STAMP}@test.com`, name: "Other walk-in" };
      const { order } = await service.createOrder({ buyer: other, rooms: [room(SLUG_B, TUE, 16)] });
      expect(order.bookings).toHaveLength(1);
      await prisma.ne26Order.deleteMany({ where: { bookerEmail: other.email } });
    });
  });

  describe("revising a basket that is already held", () => {
    // The exhibitor holds a room, then changes the add-ons and pays. The new
    // order asks for the SAME room at the SAME slot, so unless the hold gives
    // way first it collides with itself: the day rule refused the buyer their
    // own rooms, and the slot index would have refused the write anyway.
    it("replaces its own hold on that day instead of colliding with it", async () => {
      const first = await service.createOrder({ buyer: buyer(), rooms: [room(SLUG_A, TUE, 14)] });

      const second = await service.createOrder({
        buyer: buyer(),
        rooms: [{ ...room(SLUG_A, TUE, 14), addOns: [{ slug: CATERING_SLUG, quantity: 6 }] }],
      });

      expect(second.order.uid).not.toBe(first.order.uid);
      expect(second.order.amountTotal).toBe(35000 + 6 * 3500);
      // The old order is gone, not merely superseded on paper: a second row
      // holding the same slot would make the room unsellable to anyone.
      expect(await prisma.ne26Order.findUnique({ where: { uid: first.order.uid } })).toBeNull();
      expect(
        await prisma.resourceBooking.count({ where: { resourceId: roomA, startTime: at(TUE, 14) } })
      ).toBe(1);
    });

    it("puts the room it was holding back on sale", async () => {
      await service.createOrder({ buyer: buyer(), rooms: [room(SLUG_A, TUE, 14)] });

      // Same day, different room: the exhibitor changed their mind.
      await service.createOrder({ buyer: buyer(), rooms: [room(SLUG_B, TUE, 16)] });

      // Room A at 14:00 must be free for somebody else, immediately.
      const rival = { userId: null, email: `rival-${STAMP}@test.com`, name: "Rival" };
      await expect(
        service.createOrder({ buyer: rival, rooms: [room(SLUG_A, TUE, 14)] })
      ).resolves.toMatchObject({ order: { status: ResourceBookingStatus.PENDING } });
    });

    it("keeps the original hold when the new basket cannot be created", async () => {
      const first = await service.createOrder({ buyer: buyer(), rooms: [room(SLUG_A, TUE, 14)] });

      // Somebody takes Wednesday's room while the exhibitor is revising.
      const rival = { userId: null, email: `rival-${STAMP}@test.com`, name: "Rival" };
      await service.createOrder({ buyer: rival, rooms: [room(SLUG_B, WED, 10)] });

      await expect(
        service.createOrder({
          buyer: buyer(),
          rooms: [room(SLUG_A, TUE, 14), room(SLUG_B, WED, 10)],
        })
      ).rejects.toMatchObject({ code: ErrorCode.BookingConflict });

      // The release rolled back with the failed write. Losing the hold here
      // would cost the exhibitor a room they already had, for nothing.
      const still = await prisma.ne26Order.findUnique({
        where: { uid: first.order.uid },
        select: { status: true, bookings: { select: { id: true } } },
      });
      expect(still?.status).toBe(ResourceBookingStatus.PENDING);
      expect(still?.bookings).toHaveLength(1);
    });

    it("refuses to drop a day the new basket does not cover", async () => {
      // Replacing a two-day hold with a one-day basket would hand back
      // Wednesday's room without the exhibitor ever asking.
      const first = await service.createOrder({
        buyer: buyer(),
        rooms: [room(SLUG_A, TUE, 14), room(SLUG_B, WED, 10)],
      });

      await expect(
        service.createOrder({ buyer: buyer(), rooms: [room(SLUG_A, TUE, 14)] })
      ).rejects.toThrow(/holding a room that day on another unpaid order/i);

      const still = await prisma.ne26Order.findUniqueOrThrow({
        where: { uid: first.order.uid },
        select: { bookings: { select: { id: true } } },
      });
      expect(still.bookings).toHaveLength(2);
    });

    it("never lets a hold displace a room already paid for", async () => {
      const paid = await service.createOrder({ buyer: buyer(), rooms: [room(SLUG_A, TUE, 14)] });
      await orders.confirmPaid(paid.order.uid, null);

      await expect(
        service.createOrder({ buyer: buyer(), rooms: [room(SLUG_B, TUE, 16)] })
      ).rejects.toThrow(/one meeting room per day/i);

      const still = await prisma.ne26Order.findUniqueOrThrow({
        where: { uid: paid.order.uid },
        select: { status: true },
      });
      expect(still.status).toBe(ResourceBookingStatus.CONFIRMED);
    });

    it("releases only this exhibitor's own hold", async () => {
      const rival = { userId: null, email: `rival-${STAMP}@test.com`, name: "Rival" };
      const theirs = await service.createOrder({ buyer: rival, rooms: [room(SLUG_A, TUE, 14)] });

      // A different exhibitor, a different room, the same day. Nothing about
      // this order entitles it to touch the rival's hold.
      await service.createOrder({ buyer: buyer(), rooms: [room(SLUG_B, TUE, 16)] });

      const still = await prisma.ne26Order.findUniqueOrThrow({
        where: { uid: theirs.order.uid },
        select: { bookings: { select: { id: true } } },
      });
      expect(still.bookings).toHaveLength(1);
    });
  });

  describe("extending a hold to cover the payment page", () => {
    // Stripe will not open a payment page for less than thirty minutes. A buyer
    // resuming a hold with five minutes left therefore gets a page that outlives
    // their claim on the rooms — and paying it would take their money for rooms
    // already back on sale. resumeOrderCheckout pushes the hold out first; these
    // tests pin down that the push actually protects the rooms.
    const rival = () => ({ userId: null, email: `rival-${STAMP}@test.com`, name: "Rival" });

    async function ageHoldTo(uid: string, at: Date) {
      await prisma.ne26Order.update({ where: { uid }, data: { holdExpiresAt: at } });
      await prisma.resourceBooking.updateMany({ where: { orderUid: uid }, data: { holdExpiresAt: at } });
    }

    it("pushes the expiry onto the rooms, not only onto the order", async () => {
      // The reclaim path frees slots by reading the BOOKING's expiry, so an
      // order-only extension would leave the rooms collectable.
      const { order } = await service.createOrder({ buyer: buyer(), rooms: [room(SLUG_A, TUE, 14)] });
      const until = new Date(Date.now() + 45 * 60_000);

      expect(await orders.extendHold(order.uid, until)).toBe(true);

      const rooms = await prisma.resourceBooking.findMany({
        where: { orderUid: order.uid },
        select: { holdExpiresAt: true },
      });
      expect(rooms).not.toHaveLength(0);
      for (const r of rooms) expect(r.holdExpiresAt?.getTime()).toBe(until.getTime());
    });

    it("keeps the rooms off sale for the whole of the extended window", async () => {
      const { order } = await service.createOrder({ buyer: buyer(), rooms: [room(SLUG_A, TUE, 14)] });
      // One minute left — the state a buyer is in when they press "resume".
      await ageHoldTo(order.uid, new Date(Date.now() + 60_000));
      await orders.extendHold(order.uid, new Date(Date.now() + 30 * 60_000));

      await expect(
        service.createOrder({ buyer: rival(), rooms: [room(SLUG_A, TUE, 14)] })
      ).rejects.toMatchObject({ code: ErrorCode.BookingConflict });
    });

    it("shows what the extension prevents: a lapsed hold loses the rooms", async () => {
      // The same sequence WITHOUT the extension. This is the sale that was being
      // paid for after the room had already gone to somebody else.
      const { order } = await service.createOrder({ buyer: buyer(), rooms: [room(SLUG_A, TUE, 14)] });
      await ageHoldTo(order.uid, new Date(Date.now() - 60_000));

      await expect(
        service.createOrder({ buyer: rival(), rooms: [room(SLUG_A, TUE, 14)] })
      ).resolves.toMatchObject({ order: { status: ResourceBookingStatus.PENDING } });
    });

    it("never shortens a hold", async () => {
      const { order } = await service.createOrder({ buyer: buyer(), rooms: [room(SLUG_A, TUE, 14)] });
      const original = await prisma.ne26Order.findUniqueOrThrow({
        where: { uid: order.uid },
        select: { holdExpiresAt: true },
      });

      // An earlier instant, as a slow concurrent call might supply.
      expect(await orders.extendHold(order.uid, new Date(Date.now() + 60_000))).toBe(false);

      const after = await prisma.ne26Order.findUniqueOrThrow({
        where: { uid: order.uid },
        select: { holdExpiresAt: true },
      });
      expect(after.holdExpiresAt?.getTime()).toBe(original.holdExpiresAt?.getTime());
    });

    it("refuses to extend an order that has been paid", async () => {
      const { order } = await service.createOrder({ buyer: buyer(), rooms: [room(SLUG_A, TUE, 14)] });
      await orders.confirmPaid(order.uid, null);

      // A paid order has no hold to extend, and re-arming one would put a paid
      // booking back within reach of the reclaim delete.
      expect(await orders.extendHold(order.uid, new Date(Date.now() + 45 * 60_000))).toBe(false);
    });
  });

  describe("unpaid hold cap at the counter", () => {
    // A counter sale has no account, so the per-account cap cannot see it. Each
    // hold takes a room off sale, so a desk that keeps starting checkouts it
    // never finishes parks inventory nobody can buy.
    // A distinct exhibitor per sale: the cap belongs to the counter, which
    // serves one person after another, not to any single buyer. Using one email
    // six times would trip the one-room-per-day rule first and test nothing.
    function counterOrder(hour: number) {
      return service.createOrder({
        buyer: { userId: null, email: `counter-${hour}-${STAMP}@test.com`, name: `Walk-in ${hour}` },
        rooms: [room(SLUG_A, WED, hour)],
      });
    }

    it("refuses a seventh counter order waiting for payment", async () => {
      for (const hour of [9, 10, 11, 12, 13, 14]) await counterOrder(hour);
      await expect(counterOrder(15)).rejects.toMatchObject({ code: ErrorCode.BadRequest });
    });

    it("does not count a counter sale that has been paid", async () => {
      for (const hour of [9, 10, 11, 12, 13, 14]) {
        const { order } = await counterOrder(hour);
        await orders.confirmPaid(order.uid, null);
      }
      await expect(counterOrder(15)).resolves.toMatchObject({
        order: { status: ResourceBookingStatus.PENDING },
      });
    });

    it("keeps the counter and per-account caps separate", async () => {
      // Six counter holds must not stop an exhibitor booking from their phone.
      for (const hour of [9, 10, 11, 12, 13, 14]) await counterOrder(hour);

      await expect(
        service.createOrder({ buyer: buyer(), rooms: [room(SLUG_B, WED, 15)] })
      ).resolves.toMatchObject({ order: { status: ResourceBookingStatus.PENDING } });
    });
  });

  describe("unpaid hold cap per account", () => {
    // One order per day is the binding rule for an account holder, so the cap is
    // reached across the three event days rather than within one.
    // Tuesday opens at 14:00, the other two at 09:00.
    const DAYS: [string, number][] = [
      [TUE, 14],
      [WED, 9],
      [THU, 9],
    ];

    function holdOn([day, hour]: [string, number]) {
      return service.createOrder({ buyer: buyer(), rooms: [room(SLUG_A, day, hour)] });
    }

    it("never holds more than one room per day, however many orders are placed", async () => {
      for (const day of DAYS) await holdOn(day);
      // A fourth basket can only name a day already held, so it revises that
      // day rather than adding to it. The cap is belt and braces behind this:
      // with three event days and one room each, it cannot be reached.
      await holdOn(DAYS[0]);

      const live = await prisma.ne26Order.count({
        where: { bookerUserId: userId, status: ResourceBookingStatus.PENDING },
      });
      expect(live).toBe(3);
    });

    it("counts only live holds — a lapsed one blocks nothing", async () => {
      const { order } = await holdOn(DAYS[0]);
      await holdOn(DAYS[1]);
      await holdOn(DAYS[2]);

      // Age one hold out. It no longer takes its room off sale, so it must not
      // count against the cap — nor against the one-room-per-day rule.
      const expired = new Date(Date.now() - 60_000);
      await prisma.ne26Order.update({ where: { uid: order.uid }, data: { holdExpiresAt: expired } });
      await prisma.resourceBooking.updateMany({
        where: { orderUid: order.uid },
        data: { holdExpiresAt: expired },
      });

      await expect(
        service.createOrder({ buyer: buyer(), rooms: [room(SLUG_B, TUE, 15)] })
      ).resolves.toMatchObject({ order: { status: ResourceBookingStatus.PENDING } });
    });
  });
});
