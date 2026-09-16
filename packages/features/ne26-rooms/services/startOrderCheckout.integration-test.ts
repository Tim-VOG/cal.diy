import { prisma } from "@calcom/prisma";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

/**
 * A Stripe failure while starting a checkout must hand the rooms straight back.
 *
 * The Customer step sat outside the block that releases the hold on failure,
 * so when Stripe refused the stored Customer — "No such customer" on the first
 * live checkout, every profile still pointing at a test-mode Customer — the
 * room stayed off sale for the full 35-minute hold.
 */

const stripe = vi.hoisted(() => ({
  ensureCustomer: vi.fn(),
  createCheckoutSession: vi.fn(),
  expireSession: vi.fn(),
}));
vi.mock("../di/StripeCheckoutService.container", () => ({ getStripeCheckoutService: () => stripe }));

import { startOrderCheckout } from "./startOrderCheckout";

const STAMP = Date.now();
const SLUG = `test-checkout-failure-${STAMP}`;
let roomId: number;

const at = (localHour: number) => new Date(`2026-11-18T${String(localHour - 3).padStart(2, "0")}:00:00.000Z`);
const walkIn = (tag: string) => ({
  userId: null,
  email: `checkout-${tag}-${STAMP}@test.com`,
  name: "Walk-in",
});
const basket = (hour: number) => [{ slug: SLUG, startUtc: at(hour), durationHours: 1 as const }];
const heldHere = () => prisma.ne26Order.count({ where: { bookings: { some: { resourceId: roomId } } } });
const slotsHere = () => prisma.resourceSlot.count({ where: { resourceId: roomId } });

describe("startOrderCheckout when Stripe fails", () => {
  beforeAll(async () => {
    const room = await prisma.resource.create({
      data: {
        name: "TEST Checkout Failure Room",
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
    roomId = room.id;
  });

  afterEach(async () => {
    vi.resetAllMocks();
    await prisma.ne26Order.deleteMany({ where: { bookings: { some: { resourceId: roomId } } } });
    await prisma.resourceBooking.deleteMany({ where: { resourceId: roomId } });
  });

  afterAll(async () => {
    await prisma.resource.delete({ where: { id: roomId } });
  });

  it("releases the room when the Stripe Customer step fails", async () => {
    stripe.ensureCustomer.mockRejectedValue(
      Object.assign(new Error("No such customer"), { code: "resource_missing" })
    );

    await expect(
      startOrderCheckout({
        buyer: walkIn("customer"),
        rooms: basket(9),
        webappUrl: "https://rooms.test",
        cancelPath: "/rooms",
      })
    ).rejects.toThrow(/Nothing was charged and the rooms are free again/);

    expect(await heldHere()).toBe(0);
    expect(await slotsHere()).toBe(0);
    expect(stripe.createCheckoutSession).not.toHaveBeenCalled();
  });

  it("releases the room when the payment page cannot be created", async () => {
    stripe.ensureCustomer.mockResolvedValue("cus_ok");
    stripe.createCheckoutSession.mockRejectedValue(new Error("Stripe is down"));

    await expect(
      startOrderCheckout({
        buyer: walkIn("session"),
        rooms: basket(11),
        webappUrl: "https://rooms.test",
        cancelPath: "/rooms",
      })
    ).rejects.toThrow(/Nothing was charged/);

    expect(await heldHere()).toBe(0);
    expect(await slotsHere()).toBe(0);
  });

  it("keeps the hold and returns the payment page when Stripe answers", async () => {
    stripe.ensureCustomer.mockResolvedValue("cus_ok");
    stripe.createCheckoutSession.mockResolvedValue({
      id: "cs_ok",
      url: "https://checkout.stripe.test/cs_ok",
    });

    const result = await startOrderCheckout({
      buyer: walkIn("ok"),
      rooms: basket(13),
      webappUrl: "https://rooms.test",
      cancelPath: "/rooms",
    });

    expect(result.checkoutUrl).toBe("https://checkout.stripe.test/cs_ok");
    expect(await heldHere()).toBe(1);
    expect((await prisma.ne26Order.findUnique({ where: { uid: result.uid } }))?.stripeSessionId).toBe(
      "cs_ok"
    );
  });
});
