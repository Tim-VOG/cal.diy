import { describe, expect, it } from "vitest";
import { describeDecline } from "./stripeDecline";

const DECLINED = { code: "card_declined", message: "Your card was declined." };

describe("describeDecline", () => {
  it("separates the three declines that share one message", () => {
    // This is the whole point: Stripe says "Your card was declined." for all
    // three, and they need three different follow-ups.
    const broke = describeDecline({ ...DECLINED, declineCode: "insufficient_funds" });
    const stolen = describeDecline({ ...DECLINED, declineCode: "stolen_card" });
    const bank = describeDecline({ ...DECLINED, declineCode: "do_not_honor" });

    expect(broke?.reason).toContain("no room left");
    expect(stolen?.reason).toContain("stolen");
    expect(bank?.reason).toContain("without saying why");
    expect(new Set([broke?.nextStep, stolen?.nextStep, bank?.nextStep]).size).toBe(3);
  });

  it("flags the reasons the buyer must not be told", () => {
    // Stripe asks that fraud, lost and stolen be presented to the buyer as an
    // ordinary decline. Telling them is how a fraud check becomes a tip-off.
    for (const code of ["fraudulent", "lost_card", "stolen_card", "pickup_card", "merchant_blacklist"]) {
      expect(describeDecline({ ...DECLINED, declineCode: code })?.tellBuyer, code).toBe(false);
    }
  });

  it("lets the desk repeat an ordinary decline", () => {
    for (const code of ["insufficient_funds", "expired_card", "incorrect_cvc", "do_not_honor"]) {
      expect(describeDecline({ ...DECLINED, declineCode: code })?.tellBuyer, code).toBe(true);
    }
  });

  it("says a temporary error is worth retrying, and a refusal is not", () => {
    expect(describeDecline({ ...DECLINED, declineCode: "processing_error" })?.nextStep).toContain(
      "try again"
    );
    expect(describeDecline({ ...DECLINED, declineCode: "expired_card" })?.nextStep).toContain(
      "another card"
    );
  });

  it("carries Stripe's own retry advice when it sends one", () => {
    const s = describeDecline({ ...DECLINED, declineCode: "generic_decline", adviceCode: "do_not_try_again" });
    expect(s?.nextStep).toContain("will not succeed");
  });

  it("names the card so it can be recognised over the phone", () => {
    const s = describeDecline({
      ...DECLINED,
      declineCode: "insufficient_funds",
      cardBrand: "visa",
      cardLast4: "0002",
      cardCountry: "FR",
      cardFunding: "credit",
    });
    expect(s?.card).toBe("Visa ···· 0002 · FR · credit");
  });

  it("has no card line when Stripe sent no card", () => {
    expect(describeDecline({ ...DECLINED, declineCode: "generic_decline" })?.card).toBeNull();
  });

  it("keeps the codes for anyone who wants to look them up, without repeating one", () => {
    expect(describeDecline({ ...DECLINED, declineCode: "insufficient_funds" })?.codes).toBe(
      "card_declined / insufficient_funds"
    );
    expect(
      describeDecline({ code: "card_declined", declineCode: "card_declined" })?.codes
    ).toBe("card_declined");
  });

  it("falls back to Stripe's wording for a code it has never seen", () => {
    // A new decline code is more likely than a wrong one; inventing a reason
    // for a desk that will act on it is worse than passing Stripe's through.
    const s = describeDecline({ ...DECLINED, declineCode: "some_code_stripe_added_last_week" });
    expect(s?.reason).toBe("Your card was declined.");
    expect(s?.tellBuyer).toBe(true);
    expect(s?.codes).toContain("some_code_stripe_added_last_week");
  });

  it("says nothing at all rather than inventing a reason", () => {
    expect(describeDecline({})).toBeNull();
    expect(describeDecline({ code: null, declineCode: null, message: null })).toBeNull();
  });

  it("recognises a test-mode decline for what it is", () => {
    expect(describeDecline({ ...DECLINED, declineCode: "testmode_decline" })?.nextStep).toContain(
      "Nothing to chase"
    );
  });
});
