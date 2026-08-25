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

describe("resolveVatTreatment — VAT for Belgian buyers only", () => {
  const config = {
    vatOnlyForBelgium: true,
    euReverseChargeEnabled: false,
    euReverseChargeMention: "VAT reverse charge - Article 196",
    nonEuExemptEnabled: false,
    nonEuExemptMention: "VAT not applicable - outside the scope of EU VAT",
  };

  it("still charges Belgian buyers", () => {
    expect(resolveVatTreatment({ country: "BE", vatNumber: "BE0123456789" }, config)).toEqual({
      zeroRated: false,
      mention: null,
    });
  });

  it("charges a buyer whose country is unknown", () => {
    // Never zero-rate on missing information: the 21% would be VO's to owe.
    expect(resolveVatTreatment({ country: null, vatNumber: null }, config)).toEqual({
      zeroRated: false,
      mention: null,
    });
  });

  it("zero-rates an EU buyer with no VAT number at all", () => {
    // The whole point: the rule is about the country, so nothing depends on a
    // number we cannot verify.
    expect(resolveVatTreatment({ country: "DE", vatNumber: null }, config)).toEqual({
      zeroRated: true,
      mention: "VAT reverse charge - Article 196",
    });
  });

  it("zero-rates a non-EU buyer with the other mention", () => {
    // An EU buyer and a Turkish one are both zero-rated, for different legal
    // reasons — so they must not be given the same wording.
    expect(resolveVatTreatment({ country: "TR", vatNumber: "1234567890" }, config)).toEqual({
      zeroRated: true,
      mention: "VAT not applicable - outside the scope of EU VAT",
    });
  });

  it("does not need the older flags switched on", () => {
    expect(resolveVatTreatment({ country: "FR", vatNumber: null }, config).zeroRated).toBe(true);
  });

  it("changes nothing while it is off", () => {
    const off = { ...config, vatOnlyForBelgium: false };
    expect(resolveVatTreatment({ country: "DE", vatNumber: "DE123" }, off)).toEqual({
      zeroRated: false,
      mention: null,
    });
  });
});
