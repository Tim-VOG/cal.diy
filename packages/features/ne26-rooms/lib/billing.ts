interface BillingFields {
  firstName?: string | null;
  lastName?: string | null;
  country?: string | null;
}

/**
 * Whether a profile has what has to be known BEFORE the buyer reaches Stripe.
 *
 * Only three things qualify, and each for its own reason:
 *
 * - the country decides the VAT treatment, and the VAT decides the amount about
 *   to be charged to the card. It cannot wait for Checkout, because by then the
 *   price is already on the screen.
 * - the first and last name are who the welcome desk asks for at the door. They
 *   never appear on the invoice; they are how a booking is found by a person.
 *
 * Everything else the invoice needs — legal name, street, postcode, city — is
 * collected by Stripe Checkout and written onto the order by the webhook, which
 * is what a counter sale has always done. Asking for it here as well put ten
 * fields between an exhibitor and the room list, for an address the payment page
 * was going to ask for anyway.
 *
 * The VAT number stays optional: not every exhibitor is registered for it.
 */
export function isBillingProfileComplete(profile: BillingFields | null | undefined): boolean {
  return Boolean(profile?.firstName?.trim() && profile?.lastName?.trim() && profile?.country?.trim());
}
