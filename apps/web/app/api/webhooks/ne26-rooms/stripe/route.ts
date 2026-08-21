import process from "node:process";
import { getResourceBookingService } from "@calcom/features/ne26-rooms/di/ResourceBookingService.container";
import { getStripeCheckoutService } from "@calcom/features/ne26-rooms/di/StripeCheckoutService.container";
import {
  checkoutOutcome,
  isFullRefund,
  ne26BookingUid,
  paymentIdOf,
} from "@calcom/features/ne26-rooms/lib/stripeEvents";
import { formatMoney, saleNotification } from "@calcom/features/ne26-rooms/lib/teamNotification";
import { WEBAPP_URL } from "@calcom/lib/constants";
import logger from "@calcom/lib/logger";
import type Stripe from "stripe";

const log = logger.getSubLogger({ prefix: ["[ne26-rooms-stripe-webhook]"] });

/**
 * Email the NE26 team. Never throws: the webhook must still acknowledge the
 * delivery, or Stripe retries it forever.
 *
 * Recipients are the admin-configured notifyEmails list, falling back to
 * contactEmail, then to EMAIL_FROM — anything rather than a log line nobody
 * reads during a three-day event.
 */
async function notifyTeam(subject: string, body: string): Promise<void> {
  try {
    const { getInvoiceSettingsRepository } = await import(
      "@calcom/features/ne26-rooms/di/InvoiceSettingsRepository.container"
    );
    const settings = await getInvoiceSettingsRepository().get();
    const configured = settings.notifyEmails || settings.contactEmail || process.env.EMAIL_FROM || "";
    const recipients = configured.split(",");
    if (!recipients.some((a) => a.trim())) {
      log.error(`Team notification has nowhere to go: ${subject} — ${body}`);
      return;
    }
    const { sendTeamEmail } = await import("@calcom/features/ne26-rooms/lib/mailer");
    await sendTeamEmail({ to: recipients, subject, body });
  } catch (e) {
    log.error(`Could not send the team notification "${subject}"`, e);
  }
}

/** Stripe amounts are minor units; a human must never be shown "87120 EUR". */
function money(minorUnits: number | null | undefined, currency: string | null | undefined): string {
  return minorUnits === null || minorUnits === undefined
    ? "an unknown amount"
    : formatMoney(minorUnits, currency ?? "EUR");
}

/**
 * "A room just sold". Reads the booking back so the sales desk gets the room,
 * the slot, the buyer and the invoice number instead of a bare uid — and falls
 * back to the uid alone rather than staying silent if that read fails.
 */
async function notifySale(bookingUid: string, session: Stripe.Checkout.Session): Promise<void> {
  const adminUrl = `${WEBAPP_URL}/rooms/admin`;
  try {
    const { getResourceBookingRepository } = await import(
      "@calcom/features/ne26-rooms/di/ResourceBookingRepository.container"
    );
    const booking = await getResourceBookingRepository().findByUidForInvoice(bookingUid);
    if (booking) {
      const { subject, body } = saleNotification({
        bookingUid,
        roomName: booking.resource.name,
        startUtc: booking.startTime,
        endUtc: booking.endTime,
        durationMinutes: booking.durationMinutes,
        bookerName: booking.bookerName,
        bookerEmail: booking.bookerEmail,
        bookerCountry: booking.bookerCountry,
        bookerVatNumber: booking.bookerVatNumber,
        addOns: booking.addOns.map((line) => ({
          name: line.addOn.name,
          quantity: line.quantity,
          lineTotal: line.lineTotal,
        })),
        amountHt: booking.amountTotal,
        amountPaid: session.amount_total,
        currency: booking.currency,
        invoiceNumber: booking.invoiceNumber,
        adminUrl,
      });
      await notifyTeam(subject, body);
      return;
    }
  } catch (e) {
    log.error(`Could not build the sale notification for booking ${bookingUid}`, e);
  }
  await notifyTeam(
    "Room sold",
    `Booking ${bookingUid} is paid (${money(session.amount_total, session.currency)}).\n\n${adminUrl}`
  );
}

// Stripe webhook for NE26 room payments. A settled payment flips the held
// PENDING booking to CONFIRMED and invoices it; a failed or expired one releases
// the hold. Its own signing secret keeps it independent from Cal's other Stripe
// webhooks. The decision rules live in lib/stripeEvents.ts and are unit-tested.
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

  if (event.type.startsWith("checkout.session.")) {
    const session = event.data.object as Stripe.Checkout.Session;
    const bookingUid = ne26BookingUid(session);
    const outcome = checkoutOutcome(event.type, session);
    const bookingService = getResourceBookingService();

    if (bookingUid && outcome === "confirm") {
      // Persist the billing details Stripe collected (drives the invoice + VAT)
      // before confirming, while the booking is still PENDING.
      const details = session.customer_details;
      await bookingService.applyCheckoutBilling({
        bookingUid,
        country: details?.address?.country ?? null,
        vatNumber: details?.tax_ids?.[0]?.value ?? null,
        name: details?.name ?? null,
        // Counter sales have no billing profile behind them, so this is the only
        // address the invoice will ever have. Kept for web bookings too: what
        // the buyer confirmed at payment beats what they saved months earlier.
        legalName: details?.name ?? null,
        addressLine1: details?.address?.line1 ?? null,
        addressLine2: details?.address?.line2 ?? null,
        postalCode: details?.address?.postal_code ?? null,
        city: details?.address?.city ?? null,
      });

      const stripePaymentId = paymentIdOf(session);
      const confirmed = await bookingService.confirmPayment({ bookingUid, stripePaymentId });
      if (confirmed) {
        // Best-effort invoicing: a failed PDF/email must not fail the webhook
        // (payment is already confirmed) — log it for resend instead.
        try {
          const { getInvoiceService } = await import(
            "@calcom/features/ne26-rooms/di/InvoiceService.container"
          );
          await getInvoiceService().issueInvoice(bookingUid);
        } catch (e) {
          log.error(`Invoice issuance failed for booking ${bookingUid}`, e);
        }
        // Tell the team a room just sold. Best-effort: a failed notification
        // must never fail an already-confirmed payment.
        await notifySale(bookingUid, session);
      } else {
        // Money is captured but no PENDING booking matched: it was already
        // handled, or its hold lapsed and was cleared before the payment landed.
        // Nothing downstream retries, so this needs a human to reconcile or
        // refund — log at error level with everything needed to find it in Stripe.
        const detail = `Captured ${money(session.amount_total, session.currency)} for booking ${bookingUid}\nPayment intent: ${stripePaymentId}\nCheckout session: ${session.id}\n\nNo pending booking matched — it was already handled, or its hold lapsed and was cleared before the payment landed. Reconcile or refund this payment in Stripe.`;
        log.error(`UNRECONCILED PAYMENT: ${detail.replace(/\n+/g, " ")}`);
        await notifyTeam("Payment captured with no matching booking", detail);
      }
    }

    if (bookingUid && outcome === "release") {
      // Payment failed or the session expired: free the slots now rather than
      // leaving a dead hold until something else clears it.
      const released = await bookingService.cancelPending(bookingUid);
      log.info(`Released hold for booking ${bookingUid} after ${event.type} (released=${released}).`);
    }
  }

  // A FULL refund issues a credit note and frees the room's slots. Idempotent on
  // the booking side, so a replayed event is harmless.
  if (event.type === "charge.refunded") {
    const charge = event.data.object as Stripe.Charge;
    const paymentIntentId =
      typeof charge.payment_intent === "string" ? charge.payment_intent : charge.payment_intent?.id;

    if (paymentIntentId && !isFullRefund(charge)) {
      // Our credit note is all-or-nothing (full amount, booking cancelled, slots
      // freed), so a partial refund must not go through it.
      const detail = `Partial refund on payment ${paymentIntentId}: ${money(charge.amount_refunded, charge.currency)} of ${money(charge.amount, charge.currency)}.\n\nNo credit note was issued and the booking still holds its room, because our credit note is all-or-nothing (full amount, booking cancelled, slot freed). Issue the paperwork for the difference manually.`;
      log.warn(detail.replace(/\n+/g, " "));
      await notifyTeam("Partial refund needs manual paperwork", detail);
    } else if (paymentIntentId) {
      try {
        const { getInvoiceService } = await import("@calcom/features/ne26-rooms/di/InvoiceService.container");
        const issued = await getInvoiceService().issueCreditNoteByPaymentIntent(paymentIntentId);
        if (!issued) {
          log.info(
            `No credit note issued for refunded payment ${paymentIntentId} (not eligible or already credited).`
          );
        }
      } catch (e) {
        log.error(`Credit note issuance failed for refunded payment ${paymentIntentId}`, e);
      }
    }
  }

  return Response.json({ received: true });
}
