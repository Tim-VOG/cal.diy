import { EU_COUNTRY_CODES } from "./countries";

export interface VatMatrixConfig {
  /**
   * Charge VAT to Belgian buyers only; zero-rate everyone else on their country
   * alone. No VAT number is consulted, so nothing hinges on VIES.
   */
  vatOnlyForBelgium?: boolean;
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
  buyer: { country: string | null; vatNumber: string | null; vatNumberVerified?: boolean },
  config: VatMatrixConfig
): VatTreatment {
  const country = (buyer.country ?? "").trim().toUpperCase();
  if (!country || country === "BE") return { zeroRated: false, mention: null };

  const isEu = EU_COUNTRY_CODES.has(country);
  const hasVatNumber = Boolean(buyer.vatNumber?.trim());
  // Reverse charge needs a VAT number something actually VERIFIED, not one the
  // buyer typed. Prices are VAT-exclusive, so zero-rating removes the VAT we
  // would have charged and declared — on an invalid number that 21% is VO's to
  // owe. Nothing can set this to true yet: Stripe's Checkout customer_details
  // carries the number but not its VIES status. So turning euReverseChargeEnabled
  // on can no longer silently zero-rate — wire verification first, then thread it
  // through here.
  const isVerified = buyer.vatNumberVerified === true;

  // The blunt rule the business settled on. It wins over the matrix below,
  // because it is a decision about who is charged rather than about which
  // exemption applies — the mentions are still chosen per destination, since an
  // EU buyer and a Turkish one are zero-rated for different legal reasons.
  if (config.vatOnlyForBelgium) {
    return {
      zeroRated: true,
      mention: isEu ? config.euReverseChargeMention : config.nonEuExemptMention,
    };
  }

  if (isEu && hasVatNumber && isVerified && config.euReverseChargeEnabled) {
    return { zeroRated: true, mention: config.euReverseChargeMention };
  }
  if (!isEu && config.nonEuExemptEnabled) {
    return { zeroRated: true, mention: config.nonEuExemptMention };
  }
  return { zeroRated: false, mention: null };
}
