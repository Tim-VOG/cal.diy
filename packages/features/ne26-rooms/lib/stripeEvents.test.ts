import { describe, expect, it } from "vitest";
import type Stripe from "stripe";
import { checkoutOutcome, isFullRefund, ne26OrderUid, paymentIdOf } from "./stripeEvents";

function session(overrides: Partial<Stripe.Checkout.Session> = {}): Stripe.Checkout.Session {
  return {
    id: "cs_test_1",
    payment_status: "paid",
    payment_intent: "pi_test_1",
    metadata: { source: "ne26-rooms", bookingUid: "uid-1" },
    ...overrides,
  } as Stripe.Checkout.Session;
}

function charge(amount: number, amountRefunded: number): Stripe.Charge {
  return { amount, amount_refunded: amountRefunded, currency: "eur" } as Stripe.Charge;
}

describe("ne26OrderUid", () => {
  it("reads the orderUid a current session carries", () => {
    expect(ne26OrderUid(session({ metadata: { source: "ne26-rooms", orderUid: "order-9" } }))).toBe(
      "order-9"
    );
  });

  it("still reads a session created before orders existed", () => {
    // One of those can be sitting in a buyer's tab when this deploys. Rejecting
    // it would take the money and confirm nothing.
    expect(ne26OrderUid(session({ metadata: { source: "ne26-rooms", bookingUid: "old-1" } }))).toBe(
      "old-1"
    );
  });

  it("returns the uid for one of our sessions", () => {
    expect(ne26OrderUid(session())).toBe("uid-1");
  });

  it("ignores a session from another integration on the same Stripe account", () => {
    // Cal's own Stripe app shares this account; its sessions must not be touched.
    expect(ne26OrderUid(session({ metadata: { source: "cal-payments", bookingUid: "uid-1" } }))).toBeNull();
    expect(ne26OrderUid(session({ metadata: null }))).toBeNull();
  });

  it("ignores one of our sessions with no booking uid", () => {
    expect(ne26OrderUid(session({ metadata: { source: "ne26-rooms" } }))).toBeNull();
  });
});

describe("paymentIdOf", () => {
  it("takes the payment intent id, expanded or not", () => {
    expect(paymentIdOf(session())).toBe("pi_test_1");
    expect(paymentIdOf(session({ payment_intent: { id: "pi_test_2" } as Stripe.PaymentIntent }))).toBe(
      "pi_test_2"
    );
  });

  it("falls back to the session id", () => {
    expect(paymentIdOf(session({ payment_intent: null }))).toBe("cs_test_1");
  });
});

describe("checkoutOutcome — only settled money confirms a booking", () => {
  it("confirms a completed, paid session", () => {
    expect(checkoutOutcome("checkout.session.completed", session())).toBe("confirm");
  });

  it("does NOT confirm a completed but unpaid session (SEPA & other delayed methods)", () => {
    // The regression that matters: checkout.session.completed fires immediately
    // for delayed-notification methods with payment_status "unpaid". Confirming
    // it would allocate the room, burn an invoice number and email an invoice
    // for money that may never arrive.
    expect(checkoutOutcome("checkout.session.completed", session({ payment_status: "unpaid" }))).toBe(
      "ignore"
    );
  });

  it("does not confirm a session that required no payment", () => {
    expect(
      checkoutOutcome("checkout.session.completed", session({ payment_status: "no_payment_required" }))
    ).toBe("ignore");
  });

  it("confirms when a delayed payment later settles", () => {
    expect(checkoutOutcome("checkout.session.async_payment_succeeded", session())).toBe("confirm");
  });

  it("releases the hold when a delayed payment fails", () => {
    expect(
      checkoutOutcome("checkout.session.async_payment_failed", session({ payment_status: "unpaid" }))
    ).toBe("release");
  });

  it("releases the hold when the session expires", () => {
    expect(checkoutOutcome("checkout.session.expired", session({ payment_status: "unpaid" }))).toBe(
      "release"
    );
  });

  it("ignores a paid session belonging to another integration", () => {
    expect(
      checkoutOutcome("checkout.session.completed", session({ metadata: { source: "cal-payments" } }))
    ).toBe("ignore");
  });

  it("ignores event types it does not know", () => {
    expect(checkoutOutcome("checkout.session.async_payment_pending", session())).toBe("ignore");
  });
});

describe("isFullRefund — a partial refund must not cancel the booking", () => {
  it("is a full refund when everything is refunded", () => {
    expect(isFullRefund(charge(35000, 35000))).toBe(true);
  });

  it("is NOT a full refund when only part is refunded", () => {
    // The regression that matters: our credit note is all-or-nothing (full
    // amount, booking cancelled, slots freed for resale). Refunding €50 of a
    // €350 booking must not release a room the exhibitor still holds.
    expect(isFullRefund(charge(35000, 5000))).toBe(false);
  });

  it("is NOT a full refund before anything is refunded", () => {
    expect(isFullRefund(charge(35000, 0))).toBe(false);
  });

  it("treats an over-refund as full rather than partial", () => {
    expect(isFullRefund(charge(35000, 40000))).toBe(true);
  });

  it("does not treat a zero-amount charge as fully refunded", () => {
    expect(isFullRefund(charge(0, 0))).toBe(false);
  });
});
