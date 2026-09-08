import { describe, expect, it } from "vitest";
import { isBillingProfileComplete } from "./billing";

const minimal = { firstName: "Tim", lastName: "Leskens", country: "BE" };

describe("isBillingProfileComplete", () => {
  it("is false for nothing at all", () => {
    expect(isBillingProfileComplete(null)).toBe(false);
    expect(isBillingProfileComplete(undefined)).toBe(false);
    expect(isBillingProfileComplete({})).toBe(false);
  });

  it("demands a contact name — the welcome desk asks for a person, not a company", () => {
    expect(isBillingProfileComplete({ ...minimal, firstName: "" })).toBe(false);
    expect(isBillingProfileComplete({ ...minimal, lastName: "  " })).toBe(false);
    expect(isBillingProfileComplete({ ...minimal, lastName: undefined })).toBe(false);
  });

  it("demands a country, because it decides the VAT and the VAT decides the price", () => {
    // The one field that genuinely cannot wait for Checkout: by then the amount
    // is already on the screen and about to be charged.
    expect(isBillingProfileComplete({ ...minimal, country: "" })).toBe(false);
    expect(isBillingProfileComplete({ ...minimal, country: undefined })).toBe(false);
  });

  it("is satisfied by a name and a country", () => {
    expect(isBillingProfileComplete(minimal)).toBe(true);
  });

  it("no longer demands the address, which Stripe collects at payment", () => {
    // Ten fields stood between an exhibitor and the room list, for an address
    // the payment page was going to ask for anyway. A profile with none of it
    // now books, and the webhook writes what Stripe collected onto the order.
    expect(isBillingProfileComplete(minimal)).toBe(true);
    expect(
      isBillingProfileComplete({
        ...minimal,
        // @ts-expect-error — these are no longer part of the check, and passing
        // them must not change the answer either way.
        legalName: "",
        addressLine1: "",
        postalCode: "",
        city: "",
      })
    ).toBe(true);
  });

  it("does not ask for a VAT number: not every exhibitor has one", () => {
    expect(isBillingProfileComplete(minimal)).toBe(true);
  });
});
