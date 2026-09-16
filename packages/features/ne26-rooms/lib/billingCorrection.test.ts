import { describe, expect, it } from "vitest";
import { correctionColumns, describeCorrection, resolveBillTo, splitContactName } from "./billingCorrection";

const ORDER = {
  bookerLegalName: null,
  bookerAddressLine1: "Checkout street 1",
  bookerAddressLine2: null,
  bookerPostalCode: null,
  bookerCity: null,
  bookerRegion: null,
  bookerCountry: null,
  bookerVatNumber: null,
  billingCorrectedAt: null,
};
const PROFILE = {
  legalName: "Profile Co",
  addressLine2: "Floor 3",
  city: "Gent",
  country: "BE",
  vatNumber: "BE1",
};

describe("resolveBillTo", () => {
  it("prefers the order and completes it from the profile", () => {
    expect(resolveBillTo(ORDER, PROFILE)).toMatchObject({
      legalName: "Profile Co",
      addressLine1: "Checkout street 1",
      addressLine2: "Floor 3",
      city: "Gent",
      country: "BE",
    });
  });

  it("uses the order alone once an admin corrected it — except country and VAT, which are never corrected", () => {
    const billTo = resolveBillTo({ ...ORDER, billingCorrectedAt: new Date() }, PROFILE);
    expect(billTo).toMatchObject({
      legalName: null,
      addressLine2: null,
      city: null,
      country: "BE",
      vatNumber: "BE1",
    });
  });
});

describe("a correction", () => {
  const input = {
    companyName: "  ACME   SA ",
    firstName: " Jane ",
    lastName: "Doe",
    addressLine1: "Rue 1",
    addressLine2: "",
    postalCode: "1000",
    city: "Brussels",
    region: "",
  };

  it("writes only the billing columns, blanks as cleared", () => {
    expect(correctionColumns(input)).toEqual({
      bookerName: "Jane Doe",
      bookerLegalName: "ACME SA",
      bookerAddressLine1: "Rue 1",
      bookerAddressLine2: null,
      bookerPostalCode: "1000",
      bookerCity: "Brussels",
      bookerRegion: null,
    });
  });

  it("describes what changed and nothing else", () => {
    const before = {
      bookerName: "Jane Doe",
      bookerLegalName: "ACME",
      bookerCity: "Brussels",
      bookerPostalCode: "1000",
      bookerAddressLine1: "Rue 1",
    };
    expect(describeCorrection(before, correctionColumns(input))).toBe("Company: ACME → ACME SA");
    expect(describeCorrection({ ...before, bookerLegalName: "ACME SA" }, correctionColumns(input))).toBe("");
  });

  it("splits a contact name at the first space", () => {
    expect(splitContactName("Timothée  Van Leskens")).toEqual({
      firstName: "Timothée",
      lastName: "Van Leskens",
    });
    expect(splitContactName("Cher")).toEqual({ firstName: "Cher", lastName: "" });
  });
});
