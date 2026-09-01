import process from "node:process";
import { getResourceBookingService } from "@calcom/features/ne26-rooms/di/ResourceBookingService.container";
import { getStripeCheckoutService } from "@calcom/features/ne26-rooms/di/StripeCheckoutService.container";
import {
  checkoutOutcome,
  isFullRefund,
  ne26OrderUid,
  paymentIdOf,
} from "@calcom/features/ne26-rooms/lib/stripeEvents";
import {
  type FailureReason,
  failureNotification,
  formatMoney,
  saleNotification,
} from "@calcom/features/ne26-rooms/lib/teamNotification";
import { WEBAPP_URL } from "@calcom/lib/constants";
import logger from "@calcom/lib/logger";
import type { Ne26OrderRepository as Ne26OrderRepositoryLike } from "@calcom/features/ne26-rooms/repositories/Ne26OrderRepository";
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

/**
 * Where to find this payment in the Stripe dashboard.
 *
 * Test and live are separate dashboards, so the path differs; the key we are
 * signing with is what says which one we are in. Null when there is no payment
 * to point at, which is the case for an expired checkout.
 */
function stripeUrlFor(paymentId: string | null | undefined): string | null {
  if (!paymentId || !paymentId.startsWith("pi_")) return null;
  const testMode = process.env.STRIPE_PRIVATE_KEY?.startsWith("sk_test_") ?? false;
  return `https://dashboard.stripe.com/${testMode ? "test/" : ""}payments/${paymentId}`;
}

/** Stripe amounts are minor units; a human must never be shown "87120 EUR". */
function money(minorUnits: number | null | undefined, currency: string | null | undefined): string {
  return minorUnits === null || minorUnits === undefined
    ? "an unknown amount"
    : formatMoney(minorUnits, currency ?? "EUR");
}

/**
 * A hold that came to nothing: tell the buyer, and tell the desk.
 *
 * Two audiences, two purposes. The buyer believed they had a room and needs to
 * know they do not, before they arrive in Izmir expecting one. The desk gets a
 * lead worth calling back the same morning — until now this was silent on both
 * sides, and a room simply reappeared on sale.
 *
 * Never throws: the webhook must still acknowledge, or Stripe retries forever.
 */
async function notifyReleased(
  order: NonNullable<Awaited<ReturnType<Ne26OrderRepositoryLike["findByUid"]>>>,
  reason: FailureReason,
  stripeUrl: string | null
): Promise<void> {
  const rooms = order.bookings.map((b) => ({
    roomName: b.resource.name,
    startUtc: b.startTime,
    endUtc: b.endTime,
    durationMinutes: b.durationMinutes,
    addOns: b.addOns.map((a) => ({ name: a.addOn.name, quantity: a.quantity, lineTotal: a.lineTotal })),
  }));

  const { subject, body } = failureNotification({
    orderUid: order.uid,
    reason,
    rooms,
    bookerName: order.bookerName,
    bookerEmail: order.bookerEmail,
    amountHt: order.amountTotal,
    currency: order.currency,
    stripeUrl,
    adminUrl: `${WEBAPP_URL}/rooms/admin`,
  });
  await notifyTeam(subject, body);

  const first = rooms[0];
  if (!order.bookerEmail || !first) return;
  try {
    const { sendHoldReleasedEmail } = await import("@calcom/features/ne26-rooms/lib/mailer");
    const { formatSlotRange } = await import("@calcom/features/ne26-rooms/lib/teamNotification");
    await sendHoldReleasedEmail({
      to: order.bookerEmail,
      bookerName: order.bookerName || "there",
      // One room named and the rest counted, as everywhere else.
      roomName: rooms.length === 1 ? first.roomName : `${first.roomName} + ${rooms.length - 1} more`,
      slotLabel: formatSlotRange(first.startUtc, first.endUtc),
      reason,
      bookAgainUrl: `${WEBAPP_URL}/rooms`,
    });
  } catch (e) {
    // The desk has been told either way; a failed buyer email must not make
    // Stripe retry a delivery we have already acted on.
    log.error(`Could not tell ${order.bookerEmail} their hold was released`, e);
  }
}

/**
 * "A room just sold". Reads the booking back so the sales desk gets the room,
 * the slot, the buyer and the invoice number instead of a bare uid — and falls
 * back to the uid alone rather than staying silent if that read fails.
 */
async function notifySale(orderUid: string, session: Stripe.Checkout.Session): Promise<void> {
  const adminUrl = `${WEBAPP_URL}/rooms/admin`;
  try {
    const { getNe26OrderRepository } = await import(
      "@calcom/features/ne26-rooms/di/Ne26OrderRepository.container"
    );
    const order = await getNe26OrderRepository().findByUid(orderUid);
    if (order) {
      const { subject, body } = saleNotification({
        orderUid,
        rooms: order.bookings.map((b) => ({
          roomName: b.resource.name,
          startUtc: b.startTime,
          endUtc: b.endTime,
          durationMinutes: b.durationMinutes,
          addOns: b.addOns.map((a) => ({
            name: a.addOn.name,
            quantity: a.quantity,
            lineTotal: a.lineTotal,
          })),
        })),
        bookerName: order.bookerName,
        bookerEmail: order.bookerEmail,
        bookerCountry: order.bookerCountry,
        bookerVatNumber: order.bookerVatNumber,
        amountHt: order.amountTotal,
        amountPaid: session.amount_total,
        currency: order.currency,
        invoiceNumber: order.invoiceNumber,
        stripeUrl: stripeUrlFor(paymentIdOf(session)),
        adminUrl,
      });
      await notifyTeam(subject, body);
      return;
    }
  } catch (e) {
    log.error(`Could not build the sale notification for order ${orderUid}`, e);
  }
  await notifyTeam(
    "Room sold",
    `Order ${orderUid} is paid (${money(session.amount_total, session.currency)}).\n\n${adminUrl}`
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
    const orderUid = ne26OrderUid(session);
    const outcome = checkoutOutcome(event.type, session);
    const { getNe26OrderRepository } = await import(
      "@calcom/features/ne26-rooms/di/Ne26OrderRepository.container"
    );
    const orders = getNe26OrderRepository();

    if (orderUid && outcome === "confirm") {
      // Persist what Stripe collected before confirming, while the order is
      // still PENDING. It drives the invoice's "Bill to" and its VAT.
      const details = session.customer_details;
      await orders.applyCheckoutBilling(orderUid, {
        country: details?.address?.country ?? null,
        vatNumber: details?.tax_ids?.[0]?.value ?? null,
        name: details?.name ?? null,
        // A counter sale has no billing profile behind it, so this is the only
        // address the invoice will ever have. Kept for web orders too: what the
        // buyer confirmed at payment beats what they saved months earlier.
        legalName: details?.name ?? null,
        addressLine1: details?.address?.line1 ?? null,
        addressLine2: details?.address?.line2 ?? null,
        postalCode: details?.address?.postal_code ?? null,
        city: details?.address?.city ?? null,
      });

      const stripePaymentId = paymentIdOf(session);
      const confirmed = await orders.confirmPaid(orderUid, stripePaymentId);
      if (confirmed) {
        // Best-effort invoicing: a failed PDF or email must not fail the webhook
        // — the payment is already confirmed — so it is logged for resend.
        try {
          const { getInvoiceService } = await import(
            "@calcom/features/ne26-rooms/di/InvoiceService.container"
          );
          await getInvoiceService().issueInvoice(orderUid);
        } catch (e) {
          log.error(`Invoice issuance failed for order ${orderUid}`, e);
        }
        await notifySale(orderUid, session);
      } else {
        // Money is captured but no PENDING order matched: already handled, or its
        // hold lapsed and was cleared before the payment landed. Nothing
        // downstream retries, so a human has to reconcile or refund it.
        const detail = `Captured ${money(session.amount_total, session.currency)} for order ${orderUid}\nPayment intent: ${stripePaymentId}\nCheckout session: ${session.id}\n\nNo pending order matched — it was already handled, or its hold lapsed and was cleared before the payment landed. Reconcile or refund this payment in Stripe.`;
        log.error(`UNRECONCILED PAYMENT: ${detail.replace(/\n+/g, " ")}`);
        await notifyTeam("Payment captured with no matching order", detail);
      }
    }

    if (orderUid && outcome === "release") {
      // Read BEFORE cancelling: cancelPending deletes the order, and with it the
      // buyer's address and the rooms we need in order to tell anyone about it.
      const doomed = await orders.findByUid(orderUid);
      // Payment failed or the session expired: free every room in the order now
      // rather than leaving dead holds until something else clears them.
      const released = await orders.cancelPending(orderUid);
      log.info(`Released order ${orderUid} after ${event.type} (released=${released}).`);

      // Only when this delivery is what released it. A replayed event, or one
      // arriving after the hold already lapsed, must not mail anybody twice.
      if (released && doomed) {
        const reason =
          event.type === "checkout.session.async_payment_failed" ? "payment_failed" : "session_expired";
        await notifyReleased(doomed, reason, stripeUrlFor(paymentIdOf(session)));
      }
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
