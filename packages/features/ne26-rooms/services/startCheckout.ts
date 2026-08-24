import { ErrorCode } from "@calcom/lib/errorCodes";
import { ErrorWithCode } from "@calcom/lib/errors";
import { getNe26BillingProfileRepository } from "../di/Ne26BillingProfileRepository.container";
import { getResourceBookingService } from "../di/ResourceBookingService.container";
import { getRoomVatPreviewService } from "../di/RoomVatPreviewService.container";
import { getStripeCheckoutService } from "../di/StripeCheckoutService.container";
import { isBillingProfileComplete } from "../lib/billing";

export interface StartCheckoutInput {
  /**
   * The exhibitor being billed — not necessarily the person operating the app.
   * userId is null for a counter sale: no account, no saved profile, and the
   * billing address comes from Checkout instead.
   */
  buyer: { userId: number | null; email: string; name?: string | null };
  slug: string;
  startUtc: Date;
  durationHours: 1 | 2 | 3;
  addOns?: { slug: string; quantity: number }[];
  /**
   * Billing known up front. The welcome desk collects country and VAT number
   * because they decide the rate Stripe is about to charge; leaving them to be
   * discovered at Checkout would mean charging one rate and invoicing another.
   */
  billing?: {
    country?: string | null;
    vatNumber?: string | null;
    poNumber?: string | null;
    internalReference?: string | null;
  };
  webappUrl: string;
  /** Where Stripe returns the buyer if they abandon. */
  cancelPath: string;
  /**
   * Where Stripe returns them after paying. The desk overrides it: its default
   * lands on the public confirmation page, which drops the hostess out of the
   * counter shell in the middle of a shift.
   */
  successPath?: string;
}

/**
 * Hold a room for an exhibitor and hand back a Stripe Checkout URL.
 *
 * Extracted so the welcome desk can sell to someone standing at the counter
 * through exactly the same path an exhibitor uses on their own phone. Anything
 * that only existed in one of the two — the billing-profile gate, the VAT lines,
 * releasing the hold when Stripe is unreachable — would be a divergence on a
 * path that takes money, so there is one implementation and the caller only
 * supplies who is buying.
 */
export async function startCheckout(input: StartCheckoutInput) {
  const billingRepo = getNe26BillingProfileRepository();
  const atTheCounter = input.buyer.userId === null;
  const profile = atTheCounter ? null : await billingRepo.findByUserId(input.buyer.userId as number);

  // An account holder must have completed their profile: it is what the invoice
  // is made out to. A counter sale has no account to complete, so Checkout
  // collects the address instead and the webhook writes it onto the booking.
  if (!atTheCounter && !isBillingProfileComplete(profile)) {
    throw new ErrorWithCode(
      ErrorCode.BadRequest,
      "Billing details must be completed before booking — they appear on the invoice."
    );
  }

  const contactName = [profile?.firstName, profile?.lastName].filter(Boolean).join(" ");

  // Mirror the profile onto a Stripe Customer. This does not pre-fill Checkout
  // (Stripe only does that from a saved card) but it is the tax location and it
  // keeps the Stripe dashboard legible next to our invoices.
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

  const booking = await getResourceBookingService().createBooking({
    slug: input.slug,
    startUtc: input.startUtc,
    durationHours: input.durationHours,
    booker: {
      userId: input.buyer.userId,
      email: input.buyer.email,
      name: contactName || input.buyer.name || input.buyer.email,
    },
    addOns: input.addOns,
    billing: input.billing ??
      (profile
        ? {
            country: profile.country || null,
            vatNumber: profile.vatNumber || null,
            poNumber: profile.poNumber || null,
            internalReference: profile.internalReference || null,
          }
        : undefined),
  });

  // Prices are excl. VAT: add VAT lines so Stripe charges the VAT-inclusive
  // total. The rate comes from the buyer's profile plus the admin matrix
  // (reverse charge resolves to none).
  const vat = await getRoomVatPreviewService().preview({
    userId: input.buyer.userId ?? undefined,
    billing: input.billing,
    slug: input.slug,
    durationHours: input.durationHours,
    addOns: input.addOns,
  });
  const vatLines = vat.vatBreakdown
    .filter((v) => v.vat > 0)
    .map((v) => ({ name: `VAT ${v.vatRate / 100}%`, quantity: 1, unitAmount: v.vat }));

  // The hold is committed by this point. If Stripe cannot give us a Checkout
  // URL, release it now: otherwise the buyer gets a raw SDK string AND their
  // slot stays locked for the length of the hold, unbookable by anyone.
  try {
    const checkout = await getStripeCheckoutService().createCheckoutSession({
      bookingUid: booking.uid,
      currency: booking.currency,
      lines: [...booking.checkoutLines, ...vatLines],
      customerEmail: input.buyer.email,
      customerId,
      holdExpiresAt: booking.holdExpiresAt,
      requireFullAddress: atTheCounter,
      successUrl: `${input.webappUrl}${input.successPath ?? `/rooms/booked/${booking.uid}`}`,
      cancelUrl: `${input.webappUrl}${input.cancelPath}`,
    });
    // Spread the booking rather than picking fields: the callers' clients read
    // roomName, amountTotal and currency off this, and narrowing it here would
    // break them silently.
    return { ...booking, checkoutUrl: checkout.url };
  } catch (e) {
    await getResourceBookingService()
      .cancelPending(booking.uid)
      .catch(() => {
        // Releasing is best-effort; the hold expires on its own either way.
      });
    throw new ErrorWithCode(
      ErrorCode.InternalServerError,
      "We couldn't reach our payment provider. Nothing was charged and the slot is free again — please try once more."
    );
  }
}
