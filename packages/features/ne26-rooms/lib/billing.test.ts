import { describe, expect, it } from "vitest";
import { isBillingProfileComplete } from "./billing";

const full = {
  firstName: "Tim",
  lastName: "Leskens",
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

  it("demands a contact name — the welcome desk asks for a person, not a company", () => {
    expect(isBillingProfileComplete({ ...full, firstName: "" })).toBe(false);
    expect(isBillingProfileComplete({ ...full, lastName: "  " })).toBe(false);
    expect(isBillingProfileComplete({ ...full, lastName: undefined })).toBe(false);
  });

  it("is true when the contact name, legal name, country and address are present (VAT optional)", () => {
    expect(isBillingProfileComplete(full)).toBe(true);
  });
});
