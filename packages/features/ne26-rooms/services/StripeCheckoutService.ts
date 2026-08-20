import process from "node:process";
import { ErrorCode } from "@calcom/lib/errorCodes";
import { ErrorWithCode } from "@calcom/lib/errors";
import logger from "@calcom/lib/logger";
import Stripe from "stripe";

const STRIPE_API_VERSION = "2020-08-27";

const log = logger.getSubLogger({ prefix: ["[ne26-rooms-stripe]"] });

/** Stripe rejects a Checkout session expiring sooner than this. */
const STRIPE_MIN_SESSION_LIFETIME_SECONDS = 30 * 60;

export interface CreateCheckoutSessionInput {
  bookingUid: string;
  currency: string;
  /** Itemised lines shown in the Checkout summary; their sum is the amount charged. */
  lines: { name: string; description?: string; quantity: number; unitAmount: number }[];
  successUrl: string;
  cancelUrl: string;
  customerEmail?: string;
  /** Existing Stripe Customer (mirrors our billing profile) to pre-fill Checkout. */
  customerId?: string;
  /**
   * When the booking's hold lapses. The session is set to expire with it, so the
   * buyer can never pay against a hold that has already been released.
   */
  holdExpiresAt: Date;
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
   * Create or update the Stripe Customer that mirrors our billing profile, so
   * Checkout opens pre-filled (WooCommerce-style: our DB owns the data, Stripe
   * is just a mirror). Returns the Customer id to store back on the profile.
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

    // Diagnostic: exhibitors report Checkout opening with empty billing fields
    // even on a complete profile. This says what we actually sent, so the
    // question "does the Stripe Customer carry an address?" is answerable from
    // the container logs instead of by guessing. Booleans and the country code
    // only — no addresses in logs.
    log.info(
      `ensureCustomer ${input.customerId ? "update" : "create"}: name=${Boolean(params.name)} address=${Boolean(
        params.address
      )} country=${input.country ?? "-"}`
    );

    if (input.customerId) {
      const updated = await this.stripe.customers.update(input.customerId, params);
      log.info(`ensureCustomer updated ${updated.id}: stripe now holds address=${Boolean(updated.address)}`);
      return updated.id;
    }
    const created = await this.stripe.customers.create(params);
    log.info(`ensureCustomer created ${created.id}: stripe now holds address=${Boolean(created.address)}`);
    return created.id;
  }

  async createCheckoutSession(input: CreateCheckoutSessionInput): Promise<{ id: string; url: string }> {
    const metadata = { bookingUid: input.bookingUid, source: "ne26-rooms" };
    const session = await this.stripe.checkout.sessions.create({
      mode: "payment",
      client_reference_id: input.bookingUid,
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
      // Collect/confirm billing details here — the source for the invoice + VAT.
      // A pre-filled Customer (when present) seeds the address; the buyer can
      // still adjust and the webhook syncs any change back to our DB.
      billing_address_collection: "required",
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
