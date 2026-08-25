import { ErrorCode } from "@calcom/lib/errorCodes";
import { ErrorWithCode } from "@calcom/lib/errors";
import { prisma } from "@calcom/prisma";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { getResourceBookingService } from "../di/ResourceBookingService.container";

const service = getResourceBookingService();
const STAMP = Date.now();
const SLUG = `test-booking-${STAMP}`;
// Test-local add-ons: the shared seeded catalogue is admin-editable, so pinning
// totals against it would make this suite depend on production prices.
const CATERING_SLUG = `test-catering-${STAMP}`;
const SCREEN_SLUG = `test-screen-${STAMP}`;

let resourceId: number;
let bookerUserId: number;

const booker = {
  get userId() {
    return bookerUserId;
  },
  email: `exhibitor-${STAMP}@test.com`,
  name: "Exhibitor",
};

describe("ResourceBookingService.createBooking", () => {
  beforeAll(async () => {
    const room = await prisma.resource.create({
      data: {
        name: "TEST Booking Room",
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

    // Own the booker rather than borrowing Cal's "pro" seed user: this suite
    // threw in beforeAll on any database without the dev seed, and vitest then
    // silently SKIPPED every test in it — so it has not actually run in CI.
    const user = await prisma.user.create({
      data: { email: booker.email, username: `exhibitor-${STAMP}`, name: booker.name },
      select: { id: true },
    });
    bookerUserId = user.id;

    await prisma.addOn.createMany({
      data: [
        { name: "TEST Catering", slug: CATERING_SLUG, price: 3500, priceType: "PER_PERSON" },
        { name: "TEST Screen", slug: SCREEN_SLUG, price: 5000, priceType: "FLAT" },
      ],
    });

    // Pin the turnover buffer so the expected slot count is deterministic.
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
    await prisma.addOn.deleteMany({ where: { slug: { in: [CATERING_SLUG, SCREEN_SLUG] } } });
    await prisma.user.delete({ where: { id: bookerUserId } });
  });

  it("creates a PENDING booking with a hold and the correct total (room + add-ons)", async () => {
    const result = await service.createBooking({
      slug: SLUG,
      startUtc: new Date("2026-11-18T06:00:00.000Z"), // 09:00 local, sellable
      durationHours: 2,
      booker,
      addOns: [
        { slug: CATERING_SLUG, quantity: 6 }, // PER_PERSON 3500 * 6 = 21000
        { slug: SCREEN_SLUG, quantity: 1 }, // FLAT 5000
      ],
    });

    // 65000 (2h) + 21000 + 5000
    expect(result.amountTotal).toBe(91000);
    expect(result.status).toBe("PENDING");
    expect(result.holdExpiresAt.getTime()).toBeGreaterThan(Date.now());

    const booking = await prisma.resourceBooking.findUniqueOrThrow({
      where: { uid: result.uid },
      select: { amountTotal: true, slots: true, addOns: true, bookerUserId: true },
    });
    expect(booking.bookerUserId).toBe(bookerUserId);
    // 2h on the 15-minute grid = 8 slots (the buffer is pinned to 0 above).
    expect(booking.slots).toHaveLength(8);
    expect(booking.addOns).toHaveLength(2);
  });

  it("rejects a start time outside the event opening hours", async () => {
    await expect(
      service.createBooking({
        slug: SLUG,
        startUtc: new Date("2026-11-18T04:00:00.000Z"), // 07:00 local, before opening
        durationHours: 1,
        booker,
      })
    ).rejects.toMatchObject({ code: ErrorCode.BadRequest });
  });

  it("rejects an unknown add-on", async () => {
    await expect(
      service.createBooking({
        slug: SLUG,
        startUtc: new Date("2026-11-18T06:00:00.000Z"),
        durationHours: 1,
        booker,
        addOns: [{ slug: "does-not-exist", quantity: 1 }],
      })
    ).rejects.toBeInstanceOf(ErrorWithCode);
  });

  it("holds the slots long enough for Stripe Checkout to accept the session", async () => {
    // Stripe refuses a Checkout session expiring in under 30 minutes, and the
    // session must expire with the hold — so the hold can never be shorter.
    const before = Date.now();
    const result = await service.createBooking({
      slug: SLUG,
      startUtc: new Date("2026-11-18T06:00:00.000Z"),
      durationHours: 1,
      booker,
    });
    expect((result.holdExpiresAt.getTime() - before) / 60000).toBeGreaterThanOrEqual(30);
  });

  describe("mid-event, with the booking URL still live", () => {
    // Wednesday 18 Nov, 11:00 Brussels: the state the hostess tablet and any
    // broadcast link are in during the event. Only Date is faked, so Prisma's
    // internal timers keep working.
    beforeAll(() => {
      vi.useFakeTimers({ toFake: ["Date"], now: new Date("2026-11-18T08:00:00.000Z") });
    });
    afterAll(() => {
      vi.useRealTimers();
    });

    it("rejects a slot that has already started, even though it is within opening hours", async () => {
      await expect(
        service.createBooking({
          slug: SLUG,
          startUtc: new Date("2026-11-18T06:00:00.000Z"), // 09:00 Brussels, two hours ago
          durationHours: 1,
          booker,
        })
      ).rejects.toMatchObject({ code: ErrorCode.BadRequest });
    });

    it("rejects a slot from an earlier event day", async () => {
      await expect(
        service.createBooking({
          slug: SLUG,
          startUtc: new Date("2026-11-17T11:00:00.000Z"), // Tuesday, yesterday
          durationHours: 1,
          booker,
        })
      ).rejects.toMatchObject({ code: ErrorCode.BadRequest });
    });

    it("still sells a slot later the same day", async () => {
      const result = await service.createBooking({
        slug: SLUG,
        startUtc: new Date("2026-11-18T10:00:00.000Z"), // 13:00 Brussels, two hours out
        durationHours: 1,
        booker,
      });
      expect(result.status).toBe("PENDING");
    });
  });

  describe("unpaid hold cap at the counter", () => {
    // A counter sale has no account, so the per-account cap cannot see it.
    async function counterHold(hourUtc: string) {
      return service.createBooking({
        slug: SLUG,
        startUtc: new Date(hourUtc),
        durationHours: 1,
        booker: { userId: null, email: "walkin@test.com", name: "Walk-in" },
      });
    }

    it("refuses a seventh counter booking waiting for payment", async () => {
      const hours = [6, 7, 8, 9, 10, 11].map((h) => `2026-11-18T${String(h).padStart(2, "0")}:00:00.000Z`);
      for (const hour of hours) await counterHold(hour);

      await expect(counterHold("2026-11-18T12:00:00.000Z")).rejects.toMatchObject({
        code: ErrorCode.BadRequest,
      });
    });

    it("does not count a counter sale that has been paid", async () => {
      const hours = [6, 7, 8, 9, 10, 11].map((h) => `2026-11-18T${String(h).padStart(2, "0")}:00:00.000Z`);
      for (const hour of hours) {
        const booking = await counterHold(hour);
        await prisma.resourceBooking.update({
          where: { uid: booking.uid },
          data: { status: "CONFIRMED", holdExpiresAt: null },
        });
      }

      await expect(counterHold("2026-11-18T12:00:00.000Z")).resolves.toMatchObject({
        status: "PENDING",
      });
    });

    it("keeps the counter and per-account caps separate", async () => {
      // Six counter holds must not stop an exhibitor booking from their phone.
      const hours = [6, 7, 8, 9, 10, 11].map((h) => `2026-11-18T${String(h).padStart(2, "0")}:00:00.000Z`);
      for (const hour of hours) await counterHold(hour);

      await expect(
        service.createBooking({
          slug: SLUG,
          startUtc: new Date("2026-11-18T12:00:00.000Z"),
          durationHours: 1,
          booker,
        })
      ).resolves.toMatchObject({ status: "PENDING" });
    });
  });

  describe("unpaid hold cap", () => {
    // Each hold takes a room off sale for 35 minutes, so an account that keeps
    // starting checkouts it never finishes parks inventory nobody can buy.
    async function hold(hourUtc: string) {
      return service.createBooking({
        slug: SLUG,
        startUtc: new Date(hourUtc),
        durationHours: 1,
        booker,
      });
    }

    it("refuses a fourth room held unpaid at the same time", async () => {
      await hold("2026-11-18T06:00:00.000Z");
      await hold("2026-11-18T07:00:00.000Z");
      await hold("2026-11-18T08:00:00.000Z");

      await expect(hold("2026-11-18T09:00:00.000Z")).rejects.toMatchObject({
        code: ErrorCode.BadRequest,
      });
    });

    it("counts only live holds — a lapsed one blocks nothing", async () => {
      const first = await hold("2026-11-18T06:00:00.000Z");
      await hold("2026-11-18T07:00:00.000Z");
      await hold("2026-11-18T08:00:00.000Z");

      // Age one hold out. It no longer takes its room off sale, so it must not
      // count against the cap either.
      await prisma.resourceBooking.update({
        where: { uid: first.uid },
        data: { holdExpiresAt: new Date(Date.now() - 60 * 1000) },
      });

      await expect(hold("2026-11-18T09:00:00.000Z")).resolves.toMatchObject({ status: "PENDING" });
    });

    it("does not count rooms the exhibitor has already paid for", async () => {
      // Buying three rooms and coming back for a fourth is normal behaviour.
      for (const hour of ["2026-11-18T06:00:00.000Z", "2026-11-18T07:00:00.000Z", "2026-11-18T08:00:00.000Z"]) {
        const booking = await hold(hour);
        await prisma.resourceBooking.update({
          where: { uid: booking.uid },
          data: { status: "CONFIRMED", holdExpiresAt: null },
        });
      }

      await expect(hold("2026-11-18T09:00:00.000Z")).resolves.toMatchObject({ status: "PENDING" });
    });
  });

});
