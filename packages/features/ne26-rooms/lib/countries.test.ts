import { describe, expect, it } from "vitest";
import { COUNTRY_OPTIONS, EU_COUNTRY_CODES } from "./countries";

/** NATO members, ISO-3166 alpha-2. An exhibitor from one of these will come. */
const NATO = [
  "AL",
  "BE",
  "BG",
  "CA",
  "HR",
  "CZ",
  "DK",
  "EE",
  "FI",
  "FR",
  "DE",
  "GR",
  "HU",
  "IS",
  "IT",
  "LV",
  "LT",
  "LU",
  "ME",
  "NL",
  "MK",
  "NO",
  "PL",
  "PT",
  "RO",
  "SK",
  "SI",
  "ES",
  "SE",
  "TR",
  "GB",
  "US",
];

describe("the billing country list", () => {
  it("offers every NATO member, Türkiye included", () => {
    const offered = new Set(COUNTRY_OPTIONS.map((c) => c.code));
    // The host country above all: a Turkish exhibitor could not save their
    // billing details at all, and so could not pay.
    expect(offered.has("TR")).toBe(true);
    expect(NATO.filter((code) => !offered.has(code))).toEqual([]);
  });

  it("offers every EU country, since they decide the VAT treatment", () => {
    const offered = new Set(COUNTRY_OPTIONS.map((c) => c.code));
    expect(Array.from(EU_COUNTRY_CODES).filter((code) => !offered.has(code))).toEqual([]);
  });

  it("lists each country once", () => {
    const codes = COUNTRY_OPTIONS.map((c) => c.code);
    expect(new Set(codes).size).toBe(codes.length);
  });
});
