import Stripe from "stripe";

import { ErrorCode } from "@calcom/lib/errorCodes";
import { ErrorWithCode } from "@calcom/lib/errors";

const STRIPE_API_VERSION = "2020-08-27";

export interface CreateCheckoutSessionInput {
  bookingUid: string;
  amountTotal: number; // smallest currency unit (cents)
  currency: string;
  productName: string;
  successUrl: string;
  cancelUrl: string;
  customerEmail?: string;
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

  async createCheckoutSession(input: CreateCheckoutSessionInput): Promise<{ id: string; url: string }> {
    const metadata = { bookingUid: input.bookingUid, source: "ne26-rooms" };
    const session = await this.stripe.checkout.sessions.create({
      mode: "payment",
      client_reference_id: input.bookingUid,
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: input.currency.toLowerCase(),
            unit_amount: input.amountTotal,
            product_data: { name: input.productName },
          },
        },
      ],
      metadata,
      payment_intent_data: { metadata },
      // Collect billing details here — the single source for the invoice + VAT.
      billing_address_collection: "required",
      tax_id_collection: { enabled: true },
      customer_email: input.customerEmail,
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
