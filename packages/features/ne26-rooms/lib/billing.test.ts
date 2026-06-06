import { describe, expect, it } from "vitest";
import { isBillingProfileComplete } from "./billing";

const full = {
  legalName: "VO GROUP SA",
  country: "BE",
  addressLine1: "Rue Haute 139",
  postalCode: "1000",
  city: "Bruxelles",
};

describe("isBillingProfileComplete", () => {
  it("is false for null / missing required fields", () => {
    expect(isBillingProfileComplete(null)).toBe(false);
    expect(isBillingProfileComplete({ ...full, city: "" })).toBe(false);
    expect(isBillingProfileComplete({ ...full, addressLine1: "  " })).toBe(false);
    expect(isBillingProfileComplete({ ...full, legalName: undefined })).toBe(false);
  });

  it("is true when legal name, country and address are present (VAT optional)", () => {
    expect(isBillingProfileComplete(full)).toBe(true);
  });
});
