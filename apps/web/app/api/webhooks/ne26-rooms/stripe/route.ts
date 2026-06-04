import { getResourceBookingService } from "@calcom/features/ne26-rooms/di/ResourceBookingService.container";
import { getStripeCheckoutService } from "@calcom/features/ne26-rooms/di/StripeCheckoutService.container";
import logger from "@calcom/lib/logger";
import type Stripe from "stripe";

const log = logger.getSubLogger({ prefix: ["[ne26-rooms-stripe-webhook]"] });

// Stripe webhook for NE26 room payments. On checkout.session.completed we flip
// the held PENDING booking to CONFIRMED. Its own signing secret keeps it
// independent from Cal's other Stripe webhooks.
export async function POST(req: Request): Promise<Response> {
  const signature = req.headers.get("stripe-signature");
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET_NE26_ROOMS;
  if (!signature || !webhookSecret) {
    return Response.json({ error: "Missing signature or webhook secret" }, { status: 400 });
  }

  const payload = await req.text();
  let event: Stripe.Event;
  try {
    event = getStripeCheckoutService().constructWebhookEvent(payload, signature, webhookSecret);
  } catch {
    return Response.json({ error: "Invalid signature" }, { status: 400 });
  }

  if (event.type === "checkout.session.completed") {
    const session = event.data.object as Stripe.Checkout.Session;
    const bookingUid = session.metadata?.bookingUid;
    if (session.metadata?.source === "ne26-rooms" && bookingUid) {
      const stripePaymentId =
        typeof session.payment_intent === "string" ? session.payment_intent : (session.payment_intent?.id ?? session.id);
      const confirmed = await getResourceBookingService().confirmPayment({ bookingUid, stripePaymentId });
      if (confirmed) {
        // Best-effort invoicing: a failed PDF/email must not fail the webhook
        // (payment is already confirmed) — log it for resend instead.
        try {
          const { getInvoiceService } = await import("@calcom/features/ne26-rooms/di/InvoiceService.container");
          await getInvoiceService().issueInvoice(bookingUid);
        } catch (e) {
          log.error(`Invoice issuance failed for booking ${bookingUid}`, e);
        }
      } else {
        // Paid, but the booking was already handled or its hold expired and was
        // reclaimed before payment landed — needs manual review/refund.
        log.warn(`Payment for booking ${bookingUid} could not be confirmed (already handled or hold expired).`);
      }
    }
  }

  return Response.json({ received: true });
}
