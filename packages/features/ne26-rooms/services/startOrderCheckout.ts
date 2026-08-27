import { ErrorCode } from "@calcom/lib/errorCodes";
import { ErrorWithCode } from "@calcom/lib/errors";
import { getInvoiceSettingsRepository } from "../di/InvoiceSettingsRepository.container";
import { getNe26BillingProfileRepository } from "../di/Ne26BillingProfileRepository.container";
import { getNe26OrderRepository } from "../di/Ne26OrderRepository.container";
import { getStripeCheckoutService } from "../di/StripeCheckoutService.container";
import { isBillingProfileComplete } from "../lib/billing";
import { ROOM_VAT_RATE_BP, buildInvoiceModel } from "../lib/invoice";
import { resolveVatTreatment } from "../lib/vat";
import { Ne26OrderService, type OrderRoomSelection } from "./Ne26OrderService";

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
  const vat = resolveVatTreatment(
    { country: order.bookerCountry, vatNumber: order.bookerVatNumber },
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

  const checkout = await getStripeCheckoutService().createCheckoutSession({
    orderUid: order.uid,
    currency: order.currency,
    lines,
    customerEmail: input.buyerEmail,
    customerId,
    holdExpiresAt: order.holdExpiresAt,
    requireFullAddress: order.bookerUserId === null,
    successUrl: `${input.webappUrl}/rooms/booked/${order.uid}`,
    cancelUrl: `${input.webappUrl}/rooms/bookings`,
  });
  return { checkoutUrl: checkout.url };
}
