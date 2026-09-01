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

  describe("one room per exhibitor per day", () => {
    it("refuses a second room on a day already booked", async () => {
      await service.createOrder({ buyer: buyer(), rooms: [room(SLUG_A, TUE, 14)] });

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

    it("counts a live hold, not just a paid booking", async () => {
      // A hold takes the room off sale, so holding three days' worth and paying
      // for one would be exactly the loophole the rule exists to close.
      await service.createOrder({ buyer: buyer(), rooms: [room(SLUG_A, TUE, 14)] });

      await expect(
        service.createOrder({ buyer: buyer(), rooms: [room(SLUG_B, TUE, 15)] })
      ).rejects.toMatchObject({ code: ErrorCode.BadRequest });
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
      await service.createOrder({ buyer: buyer(), rooms: [room(SLUG_A, TUE, 14)] });
      await expect(service.createOrder({ buyer: buyer(), rooms: [room(SLUG_B, TUE, 16)] })).rejects.toThrow(
        /one meeting room per day/i
      );
    });

    it("holds at the counter too, matched on the exhibitor's email", async () => {
      // The rule is per EXHIBITOR, not per account. A walk-in has no userId, so
      // the email the desk collects is what identifies them — otherwise the
      // counter is a way round the rule.
      await service.createOrder({ buyer: walkIn, rooms: [room(SLUG_A, TUE, 14)] });

      await expect(
        service.createOrder({ buyer: walkIn, rooms: [room(SLUG_B, TUE, 16)] })
      ).rejects.toThrow(/one meeting room per day/i);
    });

    it("does not confuse two different walk-ins", async () => {
      await service.createOrder({ buyer: walkIn, rooms: [room(SLUG_A, TUE, 14)] });

      // A different exhibitor, same day: perfectly normal, nine rooms exist.
      const other = { userId: null, email: `walkin2-${STAMP}@test.com`, name: "Other walk-in" };
      const { order } = await service.createOrder({ buyer: other, rooms: [room(SLUG_B, TUE, 16)] });
      expect(order.bookings).toHaveLength(1);
      await prisma.ne26Order.deleteMany({ where: { bookerEmail: other.email } });
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

    it("refuses a fourth order held unpaid at the same time", async () => {
      for (const day of DAYS) await holdOn(day);

      // A fourth order can only be for a day already held, so both guards agree
      // it must be refused.
      await expect(holdOn(DAYS[0])).rejects.toMatchObject({ code: ErrorCode.BadRequest });
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
