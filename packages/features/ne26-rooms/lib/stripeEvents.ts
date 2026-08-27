import type Stripe from "stripe";

/**
 * Pure decision layer for the NE26 Stripe webhook. The handler is a thin shell
 * around these functions so the rules can be unit-tested without Stripe, a DB,
 * or an HTTP request — the webhook is where money is turned into a confirmed
 * booking, so the rules are the part that must be pinned by tests.
 */

/** What the webhook should do with a Checkout session event. */
export type CheckoutOutcome =
  /** Payment has settled: confirm the booking and invoice it. */
  | "confirm"
  /** The payment will never settle: release the hold so the slot is sellable again. */
  | "release"
  /** Not ours, or not yet decided — do nothing. */
  | "ignore";

/**
 * The order uid carried by one of our sessions, or null if the session isn't
 * ours.
 *
 * `bookingUid` is still read: a session created before orders existed carries
 * that key, and one of those can still be sitting in a buyer's tab when this
 * deploys. Rejecting it would take the money and confirm nothing.
 */
export function ne26OrderUid(session: Stripe.Checkout.Session): string | null {
  if (session.metadata?.source !== "ne26-rooms") return null;
  return session.metadata?.orderUid ?? session.metadata?.bookingUid ?? null;
}

/** The payment intent to record (falls back to the session id). */
export function paymentIdOf(session: Stripe.Checkout.Session): string {
  return typeof session.payment_intent === "string"
    ? session.payment_intent
    : (session.payment_intent?.id ?? session.id);
}

/**
 * Decide what a Checkout session event means for us.
 *
 * `checkout.session.completed` does NOT mean "paid". For delayed-notification
 * methods — SEPA Direct Debit, bank transfer, Bacs — it fires immediately with
 * `payment_status: "unpaid"` and settles days later, or fails. Since the session
 * doesn't pin `payment_method_types`, the enabled methods come from the Stripe
 * Dashboard, and a Belgian EUR account typically has SEPA on. Confirming such a
 * session would allocate the room, burn a sequential invoice number and email an
 * invoice saying the payment was received — for money that may never arrive.
 * So we confirm only on `payment_status: "paid"`, and handle the async outcomes
 * explicitly. `expired` releases the hold eagerly instead of waiting for a
 * competing booking to reclaim it.
 */
export function checkoutOutcome(eventType: string, session: Stripe.Checkout.Session): CheckoutOutcome {
  if (!ne26OrderUid(session)) return "ignore";

  switch (eventType) {
    case "checkout.session.completed":
    case "checkout.session.async_payment_succeeded":
      return session.payment_status === "paid" ? "confirm" : "ignore";
    case "checkout.session.async_payment_failed":
    case "checkout.session.expired":
      return "release";
    default:
      return "ignore";
  }
}

/**
 * Whether a `charge.refunded` event represents a FULL refund.
 *
 * The event also fires for partial refunds. Our credit-note path is all-or-
 * nothing: it credits the booking's whole `amountTotal`, cancels it and frees
 * its slots for resale. Acting on a partial refund would therefore release a
 * room the exhibitor still holds and book a full credit note against a part
 * refund. Partial refunds need a human until partial credit notes are modelled.
 */
export function isFullRefund(charge: Stripe.Charge): boolean {
  if (charge.amount <= 0) return false;
  return charge.amount_refunded >= charge.amount;
}
