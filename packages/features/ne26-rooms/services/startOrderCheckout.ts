import { ErrorCode } from "@calcom/lib/errorCodes";
import { ErrorWithCode } from "@calcom/lib/errors";
import { getInvoiceSettingsRepository } from "../di/InvoiceSettingsRepository.container";
import { getNe26BillingProfileRepository } from "../di/Ne26BillingProfileRepository.container";
import { getNe26OrderRepository } from "../di/Ne26OrderRepository.container";
import { getStripeCheckoutService } from "../di/StripeCheckoutService.container";
import { isBillingProfileComplete } from "../lib/billing";
import { buildInvoiceModel, ROOM_VAT_RATE_BP } from "../lib/invoice";
import { resolveVatTreatment } from "../lib/vat";
import { checkoutExpiresAtSeconds } from "./StripeCheckoutService";
import { Ne26OrderService, type OrderRoomSelection } from "./Ne26OrderService";

/**
 * How long an order's rooms may stay held, counting from when it was placed.
 *
 * Resuming payment pushes the hold out so it always outlives the Stripe page
 * (see resumeOrderCheckout). Without a ceiling, an exhibitor could keep a room
 * off sale for the whole event by pressing "resume" every half hour and never
 * paying.
 */
const MAX_HOLD_LIFETIME_MINUTES = 120;

export interface StartOrderCheckoutInput {
  /**
   * Who is billed. userId is null for a counter sale: no account, no saved
   * profile, and the billing address comes from Checkout instead.
   */
  buyer: { userId: number | null; email: string; name?: string | null };
  rooms: OrderRoomSelection[];
  /** Supplied by the welcome desk, which asks for them at the counter. */
  billing?: {
    country?: string | null;
    vatNumber?: string | null;
    poNumber?: string | null;
    internalReference?: string | null;
  };
  webappUrl: string;
  cancelPath: string;
  successPath?: string;
}

/**
 * Take the rooms off sale without paying for them yet.
 *
 * An exhibitor comparing rooms and picking add-ons had no way to stop somebody
 * else taking the slot while they worked, and nothing was reserved until they
 * reached Stripe. This is the deliberate act in between: the rooms are held for
 * the same window a checkout gets, a clock runs in the shortlist, and they go
 * back on sale if the payment never happens.
 *
 * Deliberately a separate button rather than something that happens as soon as
 * a slot is clicked: with nine rooms over three days, a visitor comparing five
 * of them would otherwise freeze five for half an hour just by looking.
 *
 * Everything createOrder enforces still applies — opening hours, the one room
 * per exhibitor per day, the per-account cap on unpaid holds — so this cannot
 * be used to park inventory that could not have been bought.
 */
export async function holdRooms(input: {
  buyer: { userId: number; email: string; name?: string | null };
  rooms: OrderRoomSelection[];
}): Promise<{ uid: string; holdExpiresAt: Date }> {
  const billingRepo = getNe26BillingProfileRepository();
  const profile = await billingRepo.findByUserId(input.buyer.userId);

  // The same gate as checkout. A hold that cannot become an invoice is worse
  // than no hold: the rooms are off sale and the sale still cannot complete.
  if (!isBillingProfileComplete(profile)) {
    throw new ErrorWithCode(
      ErrorCode.BadRequest,
      "Billing details must be completed before holding a room — they appear on the invoice."
    );
  }

  const contactName = [profile?.firstName, profile?.lastName].filter(Boolean).join(" ");
  const { order } = await new Ne26OrderService().createOrder({
    buyer: {
      userId: input.buyer.userId,
      email: input.buyer.email,
      name: contactName || input.buyer.name || input.buyer.email,
    },
    billing: {
      country: profile?.country || null,
      vatNumber: profile?.vatNumber || null,
      poNumber: profile?.poNumber || null,
      internalReference: profile?.internalReference || null,
    },
    rooms: input.rooms,
  });

  return { uid: order.uid, holdExpiresAt: order.holdExpiresAt as Date };
}

/**
 * Hold every room in a basket and hand back one Stripe Checkout URL.
 *
 * One payment for several rooms, the way one payment already covers a room and
 * its add-ons. The rooms are held together — a clash on any of them releases
 * them all — and the VAT is resolved once for the whole order, so the amount
 * charged is the amount the single invoice will show.
 */
export async function startOrderCheckout(input: StartOrderCheckoutInput) {
  const billingRepo = getNe26BillingProfileRepository();
  const atTheCounter = input.buyer.userId === null;
  const profile = atTheCounter ? null : await billingRepo.findByUserId(input.buyer.userId as number);

  // An account holder must have completed their profile: it is what the invoice
  // is made out to. A counter sale has no account to complete, so Checkout
  // collects the address instead and the webhook writes it onto the order.
  if (!atTheCounter && !isBillingProfileComplete(profile)) {
    throw new ErrorWithCode(
      ErrorCode.BadRequest,
      "Billing details must be completed before booking — they appear on the invoice."
    );
  }

  const contactName = [profile?.firstName, profile?.lastName].filter(Boolean).join(" ");
  const billing = input.billing ?? {
    country: profile?.country || null,
    vatNumber: profile?.vatNumber || null,
    poNumber: profile?.poNumber || null,
    internalReference: profile?.internalReference || null,
  };

  const { order, checkoutLines } = await new Ne26OrderService().createOrder({
    buyer: {
      userId: input.buyer.userId,
      email: input.buyer.email,
      name: contactName || input.buyer.name || input.buyer.email,
    },
    billing,
    rooms: input.rooms,
  });

  // VAT for the whole order, resolved BEFORE Stripe is charged. Doing it after
  // would mean charging one rate and invoicing another.
  const issuer = await getInvoiceSettingsRepository().get();
  const vat = resolveVatTreatment(
    { country: billing.country ?? null, vatNumber: billing.vatNumber ?? null },
    issuer
  );
  const model = buildInvoiceModel(
    {
      currency: order.currency,
      roomVatRate: ROOM_VAT_RATE_BP,
      rooms: order.bookings.map((b) => ({
        amountTotal: b.amountTotal,
        roomName: b.resource.name,
        durationMinutes: b.durationMinutes,
        addOns: b.addOns.map((a) => ({
          name: a.addOn.name,
          quantity: a.quantity,
          lineTotal: a.lineTotal,
          vatRate: a.vatRate,
        })),
      })),
    },
    vat
  );
  const vatLines = model.vatBreakdown
    .filter((v) => v.vat > 0)
    .map((v) => ({ name: `VAT ${v.vatRate / 100}%`, quantity: 1, unitAmount: v.vat }));

  // Mirror the profile onto a Stripe Customer. It does not pre-fill Checkout —
  // Stripe only does that from a saved card — but it is the tax location and it
  // keeps the dashboard legible next to our invoices.
  const existingCustomerId = atTheCounter
    ? null
    : await billingRepo.findStripeCustomerId(input.buyer.userId as number);
  const customerId = await getStripeCheckoutService().ensureCustomer({
    customerId: existingCustomerId,
    email: input.buyer.email,
    name: contactName || input.buyer.name,
    legalName: profile?.legalName,
    country: profile?.country,
    addressLine1: profile?.addressLine1,
    addressLine2: profile?.addressLine2,
    postalCode: profile?.postalCode,
    city: profile?.city,
  });
  if (!atTheCounter && customerId !== existingCustomerId) {
    await billingRepo.setStripeCustomerId(input.buyer.userId as number, customerId);
  }

  // The rooms are held by this point. If Stripe cannot give us a URL, release
  // them now: otherwise the buyer sees a raw SDK error AND several rooms stay
  // locked for the length of the hold, unbookable by anyone.
  try {
    const checkout = await getStripeCheckoutService().createCheckoutSession({
      orderUid: order.uid,
      currency: order.currency,
      lines: [...checkoutLines, ...vatLines],
      customerEmail: input.buyer.email,
      customerId,
      holdExpiresAt: order.holdExpiresAt as Date,
      requireFullAddress: atTheCounter,
      successUrl: `${input.webappUrl}${input.successPath ?? `/rooms/booked/${order.uid}`}`,
      cancelUrl: `${input.webappUrl}${input.cancelPath}`,
    });
    // Say how long the rooms are held, now, while the buyer still has time to
    // act on it. Someone who leaves the payment page to fetch a purchase order
    // has no other way of knowing there is a clock running.
    await getNe26OrderRepository().setStripeSessionId(order.uid, checkout.id);
    await notifyHoldTaken(order, checkout.url).catch(() => {
      // Best-effort: the rooms are held and the payment page is open. Failing
      // the checkout over a courtesy email would cost the sale.
    });
    return { ...order, checkoutUrl: checkout.url };
  } catch {
    await getNe26OrderRepository()
      .cancelPending(order.uid)
      .catch(() => {
        // Releasing is best-effort; the hold expires on its own either way.
      });
    throw new ErrorWithCode(
      ErrorCode.InternalServerError,
      "We couldn't reach our payment provider. Nothing was charged and the rooms are free again — please try once more."
    );
  }
}

/**
 * "We are holding these rooms until 14:35." Sent as soon as the hold is taken.
 *
 * Separate from the reminder fifteen minutes before it lapses: this one tells
 * the buyer a clock exists at all, which is what makes the later warning make
 * sense rather than arrive out of nowhere.
 */
async function notifyHoldTaken(
  order: { bookerEmail: string; bookerName: string; holdExpiresAt: Date | null; bookings: { startTime: Date; endTime: Date; resource: { name: string } }[] },
  payUrl: string
): Promise<void> {
  if (!order.holdExpiresAt || !order.bookerEmail) return;
  const { sendHoldReminderEmail } = await import("../lib/mailer");
  const { holdExpiryLabel, minutesUntil, roomLabelFor } = await import("./HoldReminderService");
  const { formatSlotRange } = await import("../lib/teamNotification");
  const first = order.bookings[0];
  await sendHoldReminderEmail({
    to: order.bookerEmail,
    bookerName: order.bookerName || "there",
    roomName: roomLabelFor(order.bookings),
    slotLabel: first ? formatSlotRange(first.startTime, first.endTime) : "",
    expiresAtLabel: holdExpiryLabel(order.holdExpiresAt),
    minutesLeft: minutesUntil(order.holdExpiresAt, new Date()),
    kind: "created",
    payUrl,
  });
}

/**
 * Rebuild a Checkout session for an order that was held but never paid.
 *
 * The rooms are still held, so nothing is re-priced and nothing is re-validated:
 * re-pricing here would let a mid-hold admin price change alter what the buyer
 * agreed to, and the hold is what guarantees the rooms are still theirs.
 */
export async function resumeOrderCheckout(input: {
  orderUid: string;
  buyerUserId: number | null;
  buyerEmail: string;
  webappUrl: string;
}): Promise<{ checkoutUrl: string }> {
  const orders = getNe26OrderRepository();
  const order = await orders.findByUid(input.orderUid);
  if (!order || order.status !== "PENDING" || !order.holdExpiresAt) {
    throw new ErrorWithCode(ErrorCode.NotFound, "That order is no longer awaiting payment.");
  }
  if (order.bookerUserId !== input.buyerUserId) {
    throw new ErrorWithCode(ErrorCode.NotFound, "That order is no longer awaiting payment.");
  }
  if (order.holdExpiresAt.getTime() <= Date.now()) {
    throw new ErrorWithCode(
      ErrorCode.BadRequest,
      "That hold has expired and the rooms are back on sale. Please book again."
    );
  }

  const issuer = await getInvoiceSettingsRepository().get();
  const vat = resolveVatTreatment({ country: order.bookerCountry, vatNumber: order.bookerVatNumber }, issuer);
  const model = buildInvoiceModel(
    {
      currency: order.currency,
      roomVatRate: ROOM_VAT_RATE_BP,
      rooms: order.bookings.map((b) => ({
        amountTotal: b.amountTotal,
        roomName: b.resource.name,
        durationMinutes: b.durationMinutes,
        addOns: b.addOns.map((a) => ({
          name: a.addOn.name,
          quantity: a.quantity,
          lineTotal: a.lineTotal,
          vatRate: a.vatRate,
        })),
      })),
    },
    vat
  );

  const lines = [
    ...order.bookings.flatMap((b) => {
      const addOnsHt = b.addOns.reduce((sum, a) => sum + a.lineTotal, 0);
      return [
        {
          name: `${b.resource.name} — meeting room (${b.durationMinutes / 60}h)`,
          quantity: 1,
          unitAmount: b.amountTotal - addOnsHt,
        },
        ...b.addOns.map((a) => ({
          name: `${b.resource.name} · ${a.addOn.name}`,
          quantity: a.quantity,
          unitAmount: Math.round(a.lineTotal / Math.max(1, a.quantity)),
        })),
      ];
    }),
    ...model.vatBreakdown
      .filter((v) => v.vat > 0)
      .map((v) => ({ name: `VAT ${v.vatRate / 100}%`, quantity: 1, unitAmount: v.vat })),
  ];

  const customerId = order.bookerUserId
    ? ((await getNe26BillingProfileRepository().findStripeCustomerId(order.bookerUserId)) ?? undefined)
    : undefined;

  // Stripe refuses a session shorter than 30 minutes, so a hold with 5 minutes
  // left still buys a 30-minute payment page. The hold has to be pushed out to
  // cover it: otherwise the rooms go back on sale, somebody else buys them, and
  // the first buyer's card is charged for rooms that are no longer theirs — with
  // nothing to alert anyone, because the payment itself succeeds.
  const now = new Date();
  const sessionExpiry = new Date(checkoutExpiresAtSeconds(order.holdExpiresAt, now) * 1000);
  const ceiling = new Date(order.createdAt.getTime() + MAX_HOLD_LIFETIME_MINUTES * 60_000);
  if (sessionExpiry > ceiling) {
    throw new ErrorWithCode(
      ErrorCode.BadRequest,
      "These rooms have been held for as long as we can hold them. Release them and book again — they are still on sale."
    );
  }
  // Extended BEFORE the session exists, so the hold can never be the shorter of
  // the two, whatever happens next.
  await orders.extendHold(order.uid, sessionExpiry);

  const checkout = await getStripeCheckoutService().createCheckoutSession({
    orderUid: order.uid,
    currency: order.currency,
    lines,
    customerEmail: input.buyerEmail,
    customerId,
    holdExpiresAt: sessionExpiry,
    requireFullAddress: order.bookerUserId === null,
    successUrl: `${input.webappUrl}/rooms/booked/${order.uid}`,
    cancelUrl: `${input.webappUrl}/rooms/bookings`,
  });

  // One payment page per order. The previous one still pointed at this order and
  // could be paid from a tab left open, which is a second charge waiting to
  // happen.
  if (order.stripeSessionId && order.stripeSessionId !== checkout.id) {
    await getStripeCheckoutService()
      .expireSession(order.stripeSessionId)
      .catch(() => {
        // Already completed or already expired: nothing to close.
      });
  }
  await orders.setStripeSessionId(order.uid, checkout.id);
  return { checkoutUrl: checkout.url };
}
