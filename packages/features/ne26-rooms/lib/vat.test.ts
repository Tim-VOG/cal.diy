import { describe, expect, it } from "vitest";
import { resolveVatTreatment } from "./vat";

const CONFIG = {
  euReverseChargeEnabled: true,
  euReverseChargeMention: "reverse charge",
  nonEuExemptEnabled: true,
  nonEuExemptMention: "export exempt",
};
const OFF = { ...CONFIG, euReverseChargeEnabled: false, nonEuExemptEnabled: false };

describe("resolveVatTreatment", () => {
  it("charges standard VAT for Belgian buyers", () => {
    expect(resolveVatTreatment({ country: "BE", vatNumber: "BE0123" }, CONFIG)).toEqual({
      zeroRated: false,
      mention: null,
    });
  });

  it("charges standard VAT when the country is unknown/empty", () => {
    expect(resolveVatTreatment({ country: "", vatNumber: null }, CONFIG)).toEqual({
      zeroRated: false,
      mention: null,
    });
  });

  it("reverse-charges an EU business whose VAT number was verified", () => {
    expect(
      resolveVatTreatment({ country: "fr", vatNumber: "FR123", vatNumberVerified: true }, CONFIG)
    ).toEqual({ zeroRated: true, mention: "reverse charge" });
  });

  it("does NOT reverse-charge on a VAT number nobody verified", () => {
    // The buyer types this number into Stripe Checkout. Prices are VAT-exclusive,
    // so zero-rating removes the VAT we would otherwise charge and declare — and
    // on a bogus number that 21% is VO's to owe. Verification is not wired yet,
    // so this is the state every real EU buyer is in today: enabling the rule can
    // no longer silently zero-rate.
    expect(resolveVatTreatment({ country: "fr", vatNumber: "FR123" }, CONFIG)).toEqual({
      zeroRated: false,
      mention: null,
    });
  });

  it("does NOT reverse-charge an EU buyer without a VAT number", () => {
    expect(resolveVatTreatment({ country: "FR", vatNumber: "" }, CONFIG)).toEqual({
      zeroRated: false,
      mention: null,
    });
  });

  it("does NOT reverse-charge when the rule is disabled", () => {
    expect(resolveVatTreatment({ country: "FR", vatNumber: "FR123" }, OFF)).toEqual({
      zeroRated: false,
      mention: null,
    });
  });

  it("exempts a non-EU buyer when enabled", () => {
    expect(resolveVatTreatment({ country: "US", vatNumber: null }, CONFIG)).toEqual({
      zeroRated: true,
      mention: "export exempt",
    });
  });

  it("charges standard VAT to a non-EU buyer when exemption is disabled", () => {
    expect(resolveVatTreatment({ country: "US", vatNumber: null }, OFF)).toEqual({
      zeroRated: false,
      mention: null,
    });
  });
});
