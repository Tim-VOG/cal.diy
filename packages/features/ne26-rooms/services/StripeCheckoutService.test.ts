import { describe, expect, it } from "vitest";
import { checkoutExpiresAtSeconds } from "./StripeCheckoutService";

const NOW = new Date("2026-11-17T09:00:00.000Z");
const minutesFromNow = (m: number) => new Date(NOW.getTime() + m * 60_000);

describe("checkoutExpiresAtSeconds", () => {
  it("uses the hold when the hold is long enough", () => {
    const hold = minutesFromNow(35);
    expect(checkoutExpiresAtSeconds(hold, NOW)).toBe(Math.floor(hold.getTime() / 1000));
  });

  it("cannot go below Stripe's thirty-minute floor", () => {
    // Stripe rejects a shorter session outright, which would fail the booking.
    const hold = minutesFromNow(5);
    expect(checkoutExpiresAtSeconds(hold, NOW)).toBe(Math.floor(NOW.getTime() / 1000) + 30 * 60);
  });

  it("hands back a session that OUTLIVES a nearly-lapsed hold", () => {
    // The reason resumeOrderCheckout has to push the hold out before opening a
    // payment page: a buyer resuming with five minutes left gets thirty, and
    // paying in minute twenty-five would otherwise buy rooms that went back on
    // sale twenty minutes earlier.
    const hold = minutesFromNow(5);
    expect(checkoutExpiresAtSeconds(hold, NOW) * 1000).toBeGreaterThan(hold.getTime());
  });

  it("is unaffected on a freshly placed order", () => {
    // A new hold is 35 minutes, so the floor never bites and the session and
    // the hold end together.
    const hold = minutesFromNow(35);
    expect(checkoutExpiresAtSeconds(hold, NOW) * 1000).toBeLessThanOrEqual(hold.getTime());
  });
});
