import { ErrorCode } from "@calcom/lib/errorCodes";
import { ErrorWithCode } from "@calcom/lib/errors";
import { prisma } from "@calcom/prisma";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { getResourceBookingService } from "../di/ResourceBookingService.container";

const service = getResourceBookingService();
const SLUG = `test-booking-${Date.now()}`;

let resourceId: number;
let bookerUserId: number;

const booker = {
  get userId() {
    return bookerUserId;
  },
  email: "exhibitor@test.com",
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
    const user = await prisma.user.findFirstOrThrow({ where: { username: "pro" }, select: { id: true } });
    bookerUserId = user.id;
  });

  afterEach(async () => {
    await prisma.resourceBooking.deleteMany({ where: { resourceId } });
  });

  afterAll(async () => {
    await prisma.resource.delete({ where: { id: resourceId } });
  });

  it("creates a PENDING booking with a hold and the correct total (room + add-ons)", async () => {
    const result = await service.createBooking({
      slug: SLUG,
      startUtc: new Date("2026-11-18T08:00:00.000Z"), // 09:00 Brussels, sellable
      durationHours: 2,
      booker,
      addOns: [
        { slug: "catering-lunch", quantity: 6 }, // PER_PERSON 3500 * 6 = 21000
        { slug: "av-screen", quantity: 1 }, // FLAT 5000
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
    expect(booking.slots).toHaveLength(2); // 08:00 + 09:00 UTC
    expect(booking.addOns).toHaveLength(2);
  });

  it("rejects a start time outside the event opening hours", async () => {
    await expect(
      service.createBooking({
        slug: SLUG,
        startUtc: new Date("2026-11-18T06:00:00.000Z"), // 07:00 Brussels, before opening
        durationHours: 1,
        booker,
      })
    ).rejects.toMatchObject({ code: ErrorCode.BadRequest });
  });

  it("rejects an unknown add-on", async () => {
    await expect(
      service.createBooking({
        slug: SLUG,
        startUtc: new Date("2026-11-18T08:00:00.000Z"),
        durationHours: 1,
        booker,
        addOns: [{ slug: "does-not-exist", quantity: 1 }],
      })
    ).rejects.toBeInstanceOf(ErrorWithCode);
  });
});
