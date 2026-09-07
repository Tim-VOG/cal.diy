/**
 * Turn a Stripe decline into something the sales desk can act on.
 *
 * The message Stripe puts on the error is written for the buyer and is
 * deliberately vague: "Your card was declined." is what it says for a card with
 * no money on it, for a card reported stolen, and for a corporate card whose
 * bank blocks foreign online payments. Three completely different follow-ups,
 * one sentence.
 *
 * `decline_code` is the field that separates them, so this maps it to a plain
 * reason and a next step. During a three-day event the difference between "ask
 * them to try again" and "do not chase this one" is worth having in the mail
 * rather than in Stripe's dashboard.
 *
 * Source: https://docs.stripe.com/declines/codes
 */

export interface DeclineInput {
  /** last_payment_error.code, e.g. "card_declined". */
  code?: string | null;
  /** last_payment_error.decline_code — the useful one. */
  declineCode?: string | null;
  /** The raw code the issuing bank returned, when Stripe passes it through. */
  networkDeclineCode?: string | null;
  /** Stripe's own suggestion: try_again_later / do_not_try_again / confirm_card_data. */
  adviceCode?: string | null;
  /** The customer-facing message. Kept, but never the whole story. */
  message?: string | null;
  cardBrand?: string | null;
  cardLast4?: string | null;
  cardCountry?: string | null;
  cardFunding?: string | null;
}

export interface DeclineSummary {
  /** What actually happened, in one line. */
  reason: string;
  /** What the desk should do about it. */
  nextStep: string;
  /**
   * False when Stripe asks that the real reason not be shown to the buyer —
   * fraud, a lost or stolen card, a block list. The desk still needs to know,
   * which is exactly why the mail has to say "do not repeat this".
   */
  tellBuyer: boolean;
  /** "Visa ···· 4242 · FR · credit", or null when Stripe sent no card. */
  card: string | null;
  /** The codes themselves, for anyone who wants to look them up. */
  codes: string | null;
}

interface Rule {
  reason: string;
  nextStep: string;
  tellBuyer?: false;
}

const RULES: Record<string, Rule> = {};

function rule(codes: string[], detail: Rule): void {
  for (const code of codes) RULES[code] = detail;
}

rule(["insufficient_funds", "withdrawal_count_limit_exceeded", "card_velocity_exceeded"], {
  reason: "The card has no room left — funds or limit.",
  nextStep: "They need another card. Worth a call: this one usually goes through on a second attempt.",
});
rule(["expired_card"], {
  reason: "The card has expired.",
  nextStep: "They need another card.",
});
rule(["incorrect_cvc", "invalid_cvc"], {
  reason: "The security code (CVC) was wrong.",
  nextStep:
    "They can pay straight away with the right code — no need to call unless the hold is running out.",
});
rule(["incorrect_number", "invalid_number"], {
  reason: "The card number was wrong.",
  nextStep: "They can retry with the right number.",
});
rule(["invalid_expiry_month", "invalid_expiry_year"], {
  reason: "The expiry date was wrong.",
  nextStep: "They can retry with the right date.",
});
rule(["incorrect_zip", "incorrect_address"], {
  reason: "The billing address did not match the card.",
  nextStep: "They need the address their bank has on file, not the stand's address.",
});
rule(["authentication_required", "authentication_not_handled", "mobile_device_authentication_required"], {
  reason: "The bank asked for 3-D Secure and it was not completed.",
  nextStep:
    "They can retry and confirm in their banking app or by SMS. A common failure when the phone with the app is not to hand.",
});
rule(
  [
    "do_not_honor",
    "call_issuer",
    "generic_decline",
    "no_action_taken",
    "not_permitted",
    "transaction_not_allowed",
    "service_not_allowed",
    "security_violation",
    "stop_payment_order",
    "revocation_of_authorization",
    "revocation_of_all_authorizations",
    "invalid_account",
    "new_account_information_available",
    "approve_with_id",
  ],
  {
    reason: "The bank refused without saying why.",
    nextStep:
      "They need to call their bank, or use another card. Corporate cards blocking foreign online payments are the usual cause — worth mentioning to them.",
  }
);
rule(["card_not_supported", "currency_not_supported"], {
  reason: "The card cannot be used for this kind of purchase or this currency.",
  nextStep: "They need another card.",
});
rule(["processing_error", "issuer_not_available", "reenter_transaction", "try_again_later"], {
  reason: "A temporary error, not a refusal.",
  nextStep: "Ask them to try again — this often works on the second attempt.",
});
rule(["duplicate_transaction"], {
  reason: "An identical payment was submitted moments earlier.",
  nextStep: "Check whether they have already paid before chasing them.",
});
rule(["invalid_amount"], {
  reason: "The bank refused the amount.",
  nextStep: "They need to check with their bank that they can spend this much, or use another card.",
});
rule(["testmode_decline"], {
  reason: "A Stripe test card was used.",
  nextStep: "Nothing to chase — this was a test.",
});
rule(["fraudulent", "lost_card", "stolen_card", "pickup_card", "merchant_blacklist", "restricted_card"], {
  reason: "The card was blocked as lost, stolen or fraudulent.",
  nextStep:
    "Internal only — do not repeat this reason to the buyer. Stripe asks that it be presented to them as an ordinary decline. Do not chase the sale.",
  tellBuyer: false,
});
rule(
  [
    "incorrect_pin",
    "invalid_pin",
    "pin_try_exceeded",
    "offline_pin_required",
    "online_or_offline_pin_required",
  ],
  {
    reason: "The card asked for a PIN.",
    nextStep: "A card-reader decline. Nothing to do online — they need another card.",
  }
);

/** Stripe's own retry advice, when it sends one. */
const ADVICE: Record<string, string> = {
  try_again_later: "Stripe says a later attempt may succeed.",
  do_not_try_again: "Stripe says retrying this card will not succeed.",
  confirm_card_data: "Stripe says the card details need to be checked and re-entered.",
};

/** "Visa ···· 4242 · FR · credit" — enough to recognise the card on the phone. */
function describeCard(input: DeclineInput): string | null {
  const brand = input.cardBrand ? input.cardBrand[0].toUpperCase() + input.cardBrand.slice(1) : null;
  const parts = [
    [brand, input.cardLast4 ? `···· ${input.cardLast4}` : null].filter(Boolean).join(" ") || null,
    input.cardCountry,
    input.cardFunding,
  ].filter(Boolean);
  return parts.length ? parts.join(" · ") : null;
}

/**
 * Null when Stripe told us nothing at all — better to say nothing than to
 * invent a reason for a desk that will act on it.
 */
export function describeDecline(input: DeclineInput): DeclineSummary | null {
  const declineCode = input.declineCode?.trim() || null;
  const code = input.code?.trim() || null;
  if (!declineCode && !code && !input.message) return null;

  const matched = declineCode ? RULES[declineCode] : null;
  const advice = input.adviceCode ? ADVICE[input.adviceCode] : null;

  const reason =
    matched?.reason ??
    // No mapping: Stripe's own message is still better than a code, and an
    // unmapped code is more likely a new one than a wrong one.
    input.message?.trim() ??
    "The payment was refused.";
  const nextStep = matched?.nextStep ?? "Worth a call — Stripe gave no reason we can act on.";

  const codes = [code, declineCode, input.networkDeclineCode]
    .filter((c, i, all) => c && all.indexOf(c) === i)
    .join(" / ");

  return {
    reason,
    nextStep: advice ? `${nextStep} ${advice}` : nextStep,
    tellBuyer: matched?.tellBuyer !== false,
    card: describeCard(input),
    codes: codes || null,
  };
}
