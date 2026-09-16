import type Stripe from "stripe";
import { describe, expect, it, vi } from "vitest";
import { checkoutExpiresAtSeconds, StripeCheckoutService } from "./StripeCheckoutService";

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

describe("ensureCustomer", () => {
  const input = { customerId: "cus_from_test_mode", email: "buyer@example.com", name: "Buyer" };
  const stripeWith = (update: () => Promise<unknown>) => {
    const create = vi.fn(async () => ({ id: "cus_new_live" }));
    const stripe = { customers: { update: vi.fn(update), create } } as unknown as Stripe;
    return { service: new StripeCheckoutService(stripe), create };
  };

  it("creates a new Customer when Stripe no longer knows the stored one", async () => {
    // The first live checkout: every profile still pointed at a test-mode
    // Customer, and the payment was refused with "No such customer".
    const { service, create } = stripeWith(async () => {
      throw Object.assign(new Error("No such customer: 'cus_from_test_mode'"), { code: "resource_missing" });
    });
    await expect(service.ensureCustomer(input)).resolves.toBe("cus_new_live");
    expect(create).toHaveBeenCalledTimes(1);
  });

  it("keeps the stored Customer when Stripe knows it", async () => {
    const { service, create } = stripeWith(async () => ({ id: "cus_from_test_mode" }));
    await expect(service.ensureCustomer(input)).resolves.toBe("cus_from_test_mode");
    expect(create).not.toHaveBeenCalled();
  });

  it("does not paper over any other Stripe failure", async () => {
    // An outage or a bad key must surface, not quietly create duplicates.
    const { service, create } = stripeWith(async () => {
      throw Object.assign(new Error("Invalid API Key"), { code: "api_key_invalid" });
    });
    await expect(service.ensureCustomer(input)).rejects.toThrow("Invalid API Key");
    expect(create).not.toHaveBeenCalled();
  });
});
