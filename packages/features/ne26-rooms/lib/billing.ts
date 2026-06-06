interface BillingFields {
  legalName?: string | null;
  country?: string | null;
  addressLine1?: string | null;
  postalCode?: string | null;
  city?: string | null;
}

/**
 * Whether a billing profile has everything needed for the invoice "Bill to".
 * The VAT number is intentionally optional (not every exhibitor is VAT
 * registered); legal name, country and the postal address are required.
 */
export function isBillingProfileComplete(profile: BillingFields | null | undefined): boolean {
  return Boolean(
    profile?.legalName?.trim() &&
      profile?.country?.trim() &&
      profile?.addressLine1?.trim() &&
      profile?.postalCode?.trim() &&
      profile?.city?.trim()
  );
}
