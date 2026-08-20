interface BillingFields {
  firstName?: string | null;
  lastName?: string | null;
  legalName?: string | null;
  country?: string | null;
  addressLine1?: string | null;
  postalCode?: string | null;
  city?: string | null;
}

/**
 * Whether a billing profile has everything needed for the invoice "Bill to"
 * and for the welcome desk to know who is turning up.
 *
 * The VAT number is intentionally optional (not every exhibitor is VAT
 * registered); the contact name, legal name, country and postal address are
 * required.
 */
export function isBillingProfileComplete(profile: BillingFields | null | undefined): boolean {
  return Boolean(
    profile?.firstName?.trim() &&
      profile?.lastName?.trim() &&
      profile?.legalName?.trim() &&
      profile?.country?.trim() &&
      profile?.addressLine1?.trim() &&
      profile?.postalCode?.trim() &&
      profile?.city?.trim()
  );
}
