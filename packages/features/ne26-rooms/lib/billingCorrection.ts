/**
 * Correcting the billing block of an order after the fact.
 *
 * On the shop this came up again and again: a buyer notices the wrong company
 * name or an old address on their invoice and asks for it to be fixed. Only
 * who the document is made out to may change. The number, the date, the rooms,
 * the amounts and the VAT stay exactly as issued — and so do the country and
 * the VAT number, because they decided the VAT that was charged.
 */

export interface BillToBlock {
  legalName: string | null;
  addressLine1: string | null;
  addressLine2: string | null;
  postalCode: string | null;
  city: string | null;
  region: string | null;
  country: string | null;
  vatNumber: string | null;
}

interface OrderBilling {
  bookerLegalName: string | null;
  bookerAddressLine1: string | null;
  bookerAddressLine2: string | null;
  bookerPostalCode: string | null;
  bookerCity: string | null;
  bookerRegion: string | null;
  bookerCountry: string | null;
  bookerVatNumber: string | null;
  billingCorrectedAt: Date | null;
}

interface ProfileBilling {
  legalName?: string | null;
  addressLine1?: string | null;
  addressLine2?: string | null;
  postalCode?: string | null;
  city?: string | null;
  country?: string | null;
  vatNumber?: string | null;
}

/**
 * The invoice's "Bill to".
 *
 * What the buyer confirmed at Checkout wins over the saved profile, and the
 * profile fills what Checkout left blank. Once an admin has corrected the
 * block, the order alone is the answer: a second address line removed on
 * purpose must not come back from the profile on the next render.
 */
export function resolveBillTo(order: OrderBilling, profile: ProfileBilling | null): BillToBlock {
  const fallback = order.billingCorrectedAt ? null : profile;
  return {
    legalName: order.bookerLegalName || fallback?.legalName || null,
    addressLine1: order.bookerAddressLine1 || fallback?.addressLine1 || null,
    addressLine2: order.bookerAddressLine2 || fallback?.addressLine2 || null,
    postalCode: order.bookerPostalCode || fallback?.postalCode || null,
    city: order.bookerCity || fallback?.city || null,
    region: order.bookerRegion || null,
    // Never corrected here, so the profile may always complete them.
    country: order.bookerCountry || profile?.country || null,
    vatNumber: order.bookerVatNumber || profile?.vatNumber || null,
  };
}

export interface BillingCorrection {
  companyName: string;
  firstName: string;
  lastName: string;
  addressLine1: string;
  addressLine2: string;
  postalCode: string;
  city: string;
  region: string;
}

/** "Jane Mary Doe" → first "Jane", last "Mary Doe": the form's starting values. */
export function splitContactName(name: string): { firstName: string; lastName: string } {
  const trimmed = name.trim().replace(/\s+/g, " ");
  const space = trimmed.indexOf(" ");
  return space === -1
    ? { firstName: trimmed, lastName: "" }
    : { firstName: trimmed.slice(0, space), lastName: trimmed.slice(space + 1) };
}

/** The columns a correction writes, and nothing else. Blank means cleared. */
export function correctionColumns(input: BillingCorrection) {
  const clean = (v: string) => v.trim().replace(/\s+/g, " ") || null;
  return {
    bookerName: [input.firstName, input.lastName]
      .map((v) => v.trim())
      .filter(Boolean)
      .join(" "),
    bookerLegalName: clean(input.companyName),
    bookerAddressLine1: clean(input.addressLine1),
    bookerAddressLine2: clean(input.addressLine2),
    bookerPostalCode: clean(input.postalCode),
    bookerCity: clean(input.city),
    bookerRegion: clean(input.region),
  };
}

const LABELS: Record<keyof ReturnType<typeof correctionColumns>, string> = {
  bookerName: "Contact",
  bookerLegalName: "Company",
  bookerAddressLine1: "Address",
  bookerAddressLine2: "Address line 2",
  bookerPostalCode: "Postal code",
  bookerCity: "City",
  bookerRegion: "Region",
};

/** "Company: ACME → ACME SA; City: Gent → Ghent" — for the audit trail. Empty when nothing changed. */
export function describeCorrection(
  before: Partial<Record<keyof typeof LABELS, string | null>>,
  after: ReturnType<typeof correctionColumns>
): string {
  return (Object.keys(LABELS) as (keyof typeof LABELS)[])
    .filter((key) => (before[key] || null) !== (after[key] || null))
    .map((key) => `${LABELS[key]}: ${before[key] || "—"} → ${after[key] || "—"}`)
    .join("; ");
}
