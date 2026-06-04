import { EU_COUNTRY_CODES } from "./countries";

export interface VatMatrixConfig {
  euReverseChargeEnabled: boolean;
  euReverseChargeMention: string;
  nonEuExemptEnabled: boolean;
  nonEuExemptMention: string;
}

export interface VatTreatment {
  /** When true, all invoice lines are zero-rated and `mention` is printed. */
  zeroRated: boolean;
  mention: string | null;
}

/**
 * Decide the VAT treatment for a buyer from their country + VAT number and the
 * admin-configured matrix. Belgian buyers (and unknown country) always get
 * standard Belgian VAT. The reverse-charge / exemption rules only apply when the
 * admin has enabled them — we deliberately don't hardcode Belgian VAT law (e.g.
 * the place-of-supply rules for event/room rental).
 */
export function resolveVatTreatment(
  buyer: { country: string | null; vatNumber: string | null },
  config: VatMatrixConfig
): VatTreatment {
  const country = (buyer.country ?? "").trim().toUpperCase();
  if (!country || country === "BE") return { zeroRated: false, mention: null };

  const isEu = EU_COUNTRY_CODES.has(country);
  const hasVatNumber = Boolean(buyer.vatNumber?.trim());

  if (isEu && hasVatNumber && config.euReverseChargeEnabled) {
    return { zeroRated: true, mention: config.euReverseChargeMention };
  }
  if (!isEu && config.nonEuExemptEnabled) {
    return { zeroRated: true, mention: config.nonEuExemptMention };
  }
  return { zeroRated: false, mention: null };
}
