import process from "node:process";
import { ErrorCode } from "@calcom/lib/errorCodes";
import { ErrorWithCode } from "@calcom/lib/errors";
import Stripe from "stripe";

const STRIPE_API_VERSION = "2020-08-27";

/** Stripe rejects a Checkout session expiring sooner than this. */
const STRIPE_MIN_SESSION_LIFETIME_SECONDS = 30 * 60;

export interface CreateCheckoutSessionInput {
  /** The order this payment settles. One payment can cover several rooms. */
  orderUid: string;
  currency: string;
  /** Itemised lines shown in the Checkout summary; their sum is the amount charged. */
  lines: { name: string; description?: string; quantity: number; unitAmount: number }[];
  successUrl: string;
  cancelUrl: string;
  customerEmail?: string;
  /**
   * Existing Stripe Customer mirroring our billing profile. Note this does NOT
   * pre-fill the Checkout address block — see ensureCustomer.
   */
  customerId?: string;
  /**
   * When the booking's hold lapses. The session is set to expire with it, so the
   * buyer can never pay against a hold that has already been released.
   */
  holdExpiresAt: Date;
  /**
   * Counter sale: the buyer has no account and no saved profile, so Checkout is
   * the only place their billing address can be captured — and the invoice needs
   * one. Web bookings leave this false and keep the light collection.
   */
  requireFullAddress?: boolean;
}

/**
 * Session expiry in epoch seconds, derived from the booking's hold. Clamped up to
 * Stripe's 30-minute floor: a shorter session is rejected outright, which would
 * fail the booking. The clamp can only make the session outlive the hold by
 * seconds, and a payment landing in that sliver is safe — the reclaim DELETE
 * re-checks the hold state, so it can no longer remove a paid booking.
 */
export function checkoutExpiresAtSeconds(holdExpiresAt: Date, now: Date): number {
  const nowSeconds = Math.floor(now.getTime() / 1000);
  return Math.max(
    Math.floor(holdExpiresAt.getTime() / 1000),
    nowSeconds + STRIPE_MIN_SESSION_LIFETIME_SECONDS
  );
}

export interface EnsureCustomerInput {
  /** Existing Stripe Customer id, if this exhibitor already has one. */
  customerId?: string | null;
  email: string;
  name?: string | null;
  legalName?: string | null;
  /** ISO-3166 alpha-2. */
  country?: string | null;
  addressLine1?: string | null;
  addressLine2?: string | null;
  postalCode?: string | null;
  city?: string | null;
}

/**
 * Thin wrapper around Stripe for NE26 room bookings. Uses the single shared VO
 * account configured at the instance level (STRIPE_PRIVATE_KEY) — not Stripe
 * Connect — per the brief (§4.4). Hosted Checkout keeps card data off our app.
 */
export class StripeCheckoutService {
  private stripe: Stripe;

  constructor(stripe?: Stripe) {
    if (stripe) {
      this.stripe = stripe;
      return;
    }
    const apiKey = process.env.STRIPE_PRIVATE_KEY;
    if (!apiKey) {
      throw new ErrorWithCode(ErrorCode.InternalServerError, "STRIPE_PRIVATE_KEY is not configured");
    }
    this.stripe = new Stripe(apiKey, { apiVersion: STRIPE_API_VERSION });
  }

  /**
   * Create or update the Stripe Customer that mirrors our billing profile. Our
   * DB owns the data; Stripe is the mirror. Returns the Customer id to store
   * back on the profile.
   *
   * This does NOT pre-fill the Checkout billing address, whatever the name
   * suggests. Hosted Checkout only ever pre-fills the address block from a
   * SAVED CARD's billing_details — never from customer.address, which Stripe
   * reads solely as a tax location. First-time buyers therefore always see an
   * empty address form, by design. The email is the one field that does
   * pre-fill from the Customer, and that part works.
   *
   * The mirror is still worth keeping: it is what Stripe Tax would use as the
   * tax location, and it makes the Stripe dashboard legible next to our
   * invoices.
   */
  async ensureCustomer(input: EnsureCustomerInput): Promise<string> {
    const params: Stripe.CustomerCreateParams = { email: input.email };
    const name = input.legalName || input.name;
    if (name) params.name = name;
    // Stripe's AddressParam requires line1; only mirror the address when we have it.
    if (input.addressLine1) {
      params.address = {
        line1: input.addressLine1,
        line2: input.addressLine2 || undefined,
        postal_code: input.postalCode || undefined,
        city: input.city || undefined,
        country: input.country || undefined,
      };
    }

    if (input.customerId) {
      const updated = await this.stripe.customers.update(input.customerId, params);
      return updated.id;
    }
    const created = await this.stripe.customers.create(params);
    return created.id;
  }

  async createCheckoutSession(input: CreateCheckoutSessionInput): Promise<{ id: string; url: string }> {
    const metadata = { orderUid: input.orderUid, source: "ne26-rooms" };
    const session = await this.stripe.checkout.sessions.create({
      mode: "payment",
      client_reference_id: input.orderUid,
      line_items: input.lines.map((line) => ({
        quantity: line.quantity,
        price_data: {
          currency: input.currency.toLowerCase(),
          unit_amount: line.unitAmount,
          product_data: line.description
            ? { name: line.name, description: line.description }
            : { name: line.name },
        },
      })),
      metadata,
      payment_intent_data: { metadata },
      // Die with the hold: a session outliving it lets the buyer pay for a slot
      // that has already been released to someone else.
      expires_at: checkoutExpiresAtSeconds(input.holdExpiresAt, new Date()),
      // Collect/confirm billing details here. The buyer types these from
      // scratch — a Customer does not seed them (see ensureCustomer) — and the
      // webhook syncs whatever they enter back onto the booking. A blank value
      // never overwrites what the billing profile already told us.
      // "auto" for a web booking: Checkout cannot pre-fill the address block (see
      // ensureCustomer), so "required" only meant every buyer retyping five
      // fields they had already given us, and the invoice takes the address from
      // their profile anyway.
      //
      // "required" for a counter sale, where there is no profile: this is the
      // one and only chance to capture the address the invoice needs.
      billing_address_collection: input.requireFullAddress ? "required" : "auto",
      tax_id_collection: { enabled: true },
      // Stripe forbids customer + customer_email together; prefer the Customer.
      // With an existing Customer, tax_id/address collection requires
      // customer_update=auto so Stripe may write the collected fields back.
      ...(input.customerId
        ? { customer: input.customerId, customer_update: { name: "auto", address: "auto" } }
        : { customer_email: input.customerEmail }),
      success_url: input.successUrl,
      cancel_url: input.cancelUrl,
    });
    if (!session.url) {
      throw new ErrorWithCode(ErrorCode.InternalServerError, "Stripe did not return a checkout URL");
    }
    return { id: session.id, url: session.url };
  }

  /** Verify a webhook payload's signature and return the typed event. */
  constructWebhookEvent(payload: string | Buffer, signature: string, webhookSecret: string): Stripe.Event {
    return this.stripe.webhooks.constructEvent(payload, signature, webhookSecret);
  }
}
