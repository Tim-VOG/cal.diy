// EU-27 member states (ISO-3166 alpha-2). Used to decide intra-EU VAT treatment.
// The buyer's country itself is collected by Stripe Checkout (billing address).
export const EU_COUNTRY_CODES = new Set([
  "AT",
  "BE",
  "BG",
  "HR",
  "CY",
  "CZ",
  "DK",
  "EE",
  "FI",
  "FR",
  "DE",
  "GR",
  "HU",
  "IE",
  "IT",
  "LV",
  "LT",
  "LU",
  "MT",
  "NL",
  "PL",
  "PT",
  "RO",
  "SK",
  "SI",
  "ES",
  "SE",
]);

export interface CountryOption {
  code: string;
  name: string;
}

// Belgium first (the issuer), then Türkiye (where the event is held, and the
// one country an exhibitor is certain to need), then the EU-27, then the
// remaining NATO members and the common non-EU markets. Used by the
// billing-profile country selector; the value stored is the ISO alpha-2 code.
//
// An exhibitor whose country is missing cannot finish their billing details at
// all, so a NATO event must list every NATO member — Türkiye was missing, and
// so were Albania, Iceland, Montenegro and North Macedonia.
export const COUNTRY_OPTIONS: CountryOption[] = [
  { code: "BE", name: "Belgium" },
  { code: "TR", name: "Türkiye" },
  { code: "AT", name: "Austria" },
  { code: "BG", name: "Bulgaria" },
  { code: "HR", name: "Croatia" },
  { code: "CY", name: "Cyprus" },
  { code: "CZ", name: "Czechia" },
  { code: "DK", name: "Denmark" },
  { code: "EE", name: "Estonia" },
  { code: "FI", name: "Finland" },
  { code: "FR", name: "France" },
  { code: "DE", name: "Germany" },
  { code: "GR", name: "Greece" },
  { code: "HU", name: "Hungary" },
  { code: "IE", name: "Ireland" },
  { code: "IT", name: "Italy" },
  { code: "LV", name: "Latvia" },
  { code: "LT", name: "Lithuania" },
  { code: "LU", name: "Luxembourg" },
  { code: "MT", name: "Malta" },
  { code: "NL", name: "Netherlands" },
  { code: "PL", name: "Poland" },
  { code: "PT", name: "Portugal" },
  { code: "RO", name: "Romania" },
  { code: "SK", name: "Slovakia" },
  { code: "SI", name: "Slovenia" },
  { code: "ES", name: "Spain" },
  { code: "SE", name: "Sweden" },
  { code: "AL", name: "Albania" },
  { code: "CA", name: "Canada" },
  { code: "IS", name: "Iceland" },
  { code: "ME", name: "Montenegro" },
  { code: "MK", name: "North Macedonia" },
  { code: "NO", name: "Norway" },
  { code: "CH", name: "Switzerland" },
  { code: "GB", name: "United Kingdom" },
  { code: "US", name: "United States" },
];
