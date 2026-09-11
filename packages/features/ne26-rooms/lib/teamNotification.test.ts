import { describe, expect, it } from "vitest";
import { failureNotification, formatMoney, refundNotification, saleNotification } from "./teamNotification";

const SUITE_1 = {
  roomName: "Suite 1",
  startUtc: new Date("2026-11-17T13:00:00.000Z"),
  endUtc: new Date("2026-11-17T15:00:00.000Z"),
  durationMinutes: 120,
  addOns: [{ name: "Catering - Lunch", quantity: 2, lineTotal: 14000 }],
};

const BASE = {
  orderUid: "2fe0f775-7681-4cb1-a0c3-b21dac06219d",
  rooms: [SUITE_1],
  bookerName: "Jane Exhibitor",
  bookerEmail: "jane@example.com",
  bookerCountry: "FR",
  bookerVatNumber: "FR12345678901",
  amountHt: 72000,
  amountPaid: 87120,
  currency: "EUR",
  invoiceNumber: "NE26-2026-0007",
  adminUrl: "https://rooms.vo-eu.be/rooms/admin",
};

describe("formatMoney", () => {
  it("converts minor units to a human amount", () => {
    // The sales team was told a 871.20 EUR booking was "87120 EUR".
    expect(formatMoney(87120, "EUR")).toBe("871.20 EUR");
  });

  it("keeps trailing zeros so amounts line up", () => {
    expect(formatMoney(72000, "eur")).toBe("720.00 EUR");
    expect(formatMoney(0, "EUR")).toBe("0.00 EUR");
  });
});

describe("saleNotification", () => {
  it("never prints a raw minor-unit amount", () => {
    const { subject, body } = saleNotification(BASE);
    expect(subject).not.toContain("87120");
    expect(body).not.toContain("87120");
    expect(body).not.toContain("72000");
    expect(body).not.toContain("14000");
  });

  it("names the room, the duration and the amount paid in the subject", () => {
    expect(saleNotification(BASE).subject).toBe("Room sold — Suite 1, 2h (871.20 EUR)");
  });

  it("reports both the excl.-VAT order total and what Stripe captured", () => {
    const { body } = saleNotification(BASE);
    expect(body).toContain("720.00 EUR");
    expect(body).toContain("871.20 EUR");
  });

  it("carries the slot in the event's local time, not UTC", () => {
    // Istanbul is UTC+3 all year, so 13:00 UTC is 16:00 locally.
    expect(saleNotification(BASE).body).toContain("Tue, 17 Nov 2026, 16:00-18:00 TRT");
  });

  it("gives a clickable admin link, not a bare path", () => {
    expect(saleNotification(BASE).body).toContain("https://rooms.vo-eu.be/rooms/admin");
  });

  it("lists the add-ons with their quantities", () => {
    expect(saleNotification(BASE).body).toContain("Catering - Lunch x 2 — 140.00 EUR");
  });

  it("still reads correctly with no add-ons, no VAT number and no invoice yet", () => {
    const { subject, body } = saleNotification({
      ...BASE,
      rooms: [{ ...SUITE_1, addOns: [] }],
      bookerVatNumber: null,
      bookerCountry: null,
      invoiceNumber: null,
      amountPaid: null,
    });
    expect(subject).toBe("Room sold — Suite 1, 2h");
    expect(body).not.toContain("Catering");
    expect(body).not.toContain("Invoice:");
    expect(body).toContain("720.00 EUR");
  });

  it("falls back to a neutral buyer label rather than printing 'null'", () => {
    const { body } = saleNotification({ ...BASE, bookerName: null, bookerEmail: null });
    expect(body).toContain("An exhibitor");
    expect(body).not.toContain("null");
  });

  describe("an order covering several rooms", () => {
    const MULTI = {
      ...BASE,
      rooms: [
        SUITE_1,
        {
          roomName: "Studio 3",
          startUtc: new Date("2026-11-18T07:00:00.000Z"),
          endUtc: new Date("2026-11-18T08:00:00.000Z"),
          durationMinutes: 60,
          addOns: [],
        },
      ],
      amountHt: 102000,
      amountPaid: 123420,
    };

    it("counts the rooms in the subject instead of naming them all", () => {
      // Naming three rooms would run past what any mail client shows.
      expect(saleNotification(MULTI).subject).toBe("Room sold — 2 rooms (1234.20 EUR)");
    });

    it("lists every room with its own slot in the body", () => {
      const { body } = saleNotification(MULTI);
      expect(body).toContain("Suite 1 — 2h");
      expect(body).toContain("Tue, 17 Nov 2026, 16:00-18:00 TRT");
      expect(body).toContain("Studio 3 — 1h");
      expect(body).toContain("Wed, 18 Nov 2026, 10:00-11:00 TRT");
    });

    it("reports one total for the whole order, not one per room", () => {
      const { body } = saleNotification(MULTI);
      expect(body).toContain("1020.00 EUR");
      expect(body).toContain("1234.20 EUR");
      // The single order reference is what ties the payment to the invoice.
      expect(body).toContain(BASE.orderUid);
    });

    it("attaches each add-on to the room it belongs to", () => {
      // Add-ons were printed in one flat list, so a lunch ordered for Suite 1
      // read as if it belonged to Studio 3.
      const body = saleNotification(MULTI).body;
      const suiteAt = body.indexOf("Suite 1 — 2h");
      const cateringAt = body.indexOf("Catering - Lunch");
      const studioAt = body.indexOf("Studio 3 — 1h");
      expect(cateringAt).toBeGreaterThan(suiteAt);
      expect(cateringAt).toBeLessThan(studioAt);
    });
  });
});

describe("the Stripe link on a sale", () => {
  it("prints the payment link so the desk does not search by amount", () => {
    const url = "https://dashboard.stripe.com/test/payments/pi_123";
    expect(saleNotification({ ...BASE, stripeUrl: url }).body).toContain(url);
  });

  it("stays silent when there is no link — an offline sale has no payment", () => {
    const { body } = saleNotification({ ...BASE, stripeUrl: null });
    expect(body).not.toContain("dashboard.stripe.com");
    expect(body.trimEnd()).toBe(body.trimEnd());
  });
});

describe("failureNotification", () => {
  const FAILED = {
    orderUid: BASE.orderUid,
    reason: "payment_failed" as const,
    rooms: BASE.rooms,
    bookerName: "Jane Exhibitor",
    bookerEmail: "jane@example.com",
    amountHt: 72000,
    currency: "EUR",
    adminUrl: BASE.adminUrl,
  };

  it("names the room and the money that did not come in", () => {
    expect(failureNotification(FAILED).subject).toBe("Payment failed — Suite 1, 2h (720.00 EUR)");
  });

  it("distinguishes an abandoned checkout from a declined card", () => {
    // The desk calls one back differently from the other.
    const expired = failureNotification({ ...FAILED, reason: "session_expired" });
    expect(expired.subject).toMatch(/^Checkout expired/);
    expect(expired.body).toContain("never completed");
    expect(failureNotification(FAILED).body).toContain("declined");
  });

  it("says the rooms are back on sale, which is the actionable part", () => {
    expect(failureNotification(FAILED).body).toContain("back on sale");
  });

  it("carries the buyer so the desk can call them back", () => {
    expect(failureNotification(FAILED).body).toContain("Jane Exhibitor <jane@example.com>");
  });

  it("never prints a raw minor-unit amount", () => {
    const { subject, body } = failureNotification(FAILED);
    expect(subject).not.toContain("72000");
    expect(body).not.toContain("72000");
    expect(body).toContain("720.00 EUR");
  });

  it("counts the rooms rather than naming them all", () => {
    const two = failureNotification({
      ...FAILED,
      rooms: [
        SUITE_1,
        {
          roomName: "Studio 3",
          startUtc: new Date("2026-11-18T07:00:00.000Z"),
          endUtc: new Date("2026-11-18T08:00:00.000Z"),
          durationMinutes: 60,
          addOns: [],
        },
      ],
    });
    expect(two.subject).toContain("2 rooms");
    expect(two.body).toContain("Studio 3 — 1h");
  });

  it("falls back to a neutral buyer label rather than printing 'null'", () => {
    const { body } = failureNotification({ ...FAILED, bookerName: null, bookerEmail: null });
    expect(body).toContain("An exhibitor");
    expect(body).not.toContain("null");
  });
});

describe("a card that was declined, not a sale that was lost", () => {
  const DECLINED = {
    orderUid: BASE.orderUid,
    reason: "payment_attempt_failed" as const,
    rooms: BASE.rooms,
    bookerName: "Jane Exhibitor",
    bookerEmail: "jane@example.com",
    amountHt: 72000,
    currency: "EUR",
    adminUrl: BASE.adminUrl,
    holdUntilLabel: "14:35 TRT",
    declineMessage: "Your card was declined.",
  };

  it("does not tell the desk the rooms are back on sale", () => {
    // They are not. The session is still open, the hold stands, and the buyer
    // is on the payment page trying another card. Sending the desk after a
    // sale that is still live is worse than sending nothing.
    const { body } = failureNotification(DECLINED);
    expect(body).not.toContain("back on sale");
    expect(body).toContain("still held");
    expect(body).toContain("14:35 TRT");
  });

  it("says what the bank said, so the desk can advise", () => {
    expect(failureNotification(DECLINED).body).toContain("Your card was declined.");
  });

  it("calls the money at stake, not lost", () => {
    const { body } = failureNotification(DECLINED);
    expect(body).toContain("At stake");
    expect(body).not.toContain("Lost (excl. VAT)");
  });

  it("is titled differently from an expired checkout", () => {
    expect(failureNotification(DECLINED).subject).toMatch(/^Payment declined/);
    expect(failureNotification({ ...DECLINED, reason: "session_expired" }).subject).toMatch(
      /^Checkout expired/
    );
  });

  it("still reads without a hold time or a bank message", () => {
    const { body } = failureNotification({
      ...DECLINED,
      holdUntilLabel: null,
      declineMessage: null,
    });
    expect(body).toContain("still held");
    expect(body).not.toContain("null");
    expect(body).not.toContain("undefined");
  });
});

/**
 * The sales desk used to get these as a monospace block. They now carry the
 * same layout as the invoice mail — which only helps if the content survived
 * the move, and if a buyer cannot write HTML into an internal mail.
 */
describe("the laid-out version of the team mails", () => {
  it("says the same things as the text body", () => {
    const { html } = saleNotification(BASE);
    expect(html).toContain("Suite 1");
    expect(html).toContain("Tue, 17 Nov 2026, 16:00-18:00 TRT");
    expect(html).toContain("871.20 EUR");
    expect(html).toContain("NE26-2026-0007");
    expect(html).toContain("jane@example.com");
    expect(html).toContain(BASE.orderUid);
  });

  it("links to the admin dashboard and to Stripe", () => {
    const url = "https://dashboard.stripe.com/test/payments/pi_123";
    const { html } = saleNotification({ ...BASE, stripeUrl: url });
    expect(html).toContain(`href="${BASE.adminUrl}"`);
    expect(html).toContain(`href="${url}"`);
  });

  it("has no Stripe link to offer when there is no payment", () => {
    expect(saleNotification({ ...BASE, stripeUrl: null }).html).not.toContain("dashboard.stripe.com");
  });

  it("cannot be used to put markup into the team's inbox", () => {
    // The buyer's name is theirs to choose, and it lands in an internal mail.
    const { html } = saleNotification({ ...BASE, bookerName: "<img src=x onerror=alert(1)>" });
    expect(html).not.toContain("<img");
    expect(html).toContain("&lt;img src=x onerror=alert(1)&gt;");
  });

  it("prints no raw minor units, in the HTML either", () => {
    const { html } = saleNotification(BASE);
    expect(html).not.toContain("87120");
    expect(html).not.toContain("72000");
  });

  it("calls a declined card money at stake, not money lost", () => {
    const { html } = failureNotification({
      orderUid: BASE.orderUid,
      reason: "payment_attempt_failed",
      rooms: BASE.rooms,
      bookerName: "Jane Exhibitor",
      bookerEmail: "jane@example.com",
      amountHt: 72000,
      currency: "EUR",
      adminUrl: BASE.adminUrl,
      holdUntilLabel: "14:35 TRT",
      declineMessage: "Your card was declined.",
    });
    expect(html).toContain("At stake");
    expect(html).not.toContain("Lost (excl. VAT)");
    expect(html).toContain("still held");
    expect(html).toContain("Your card was declined.");
  });
});

describe("the decline, explained", () => {
  const BASE_FAIL = {
    orderUid: BASE.orderUid,
    reason: "payment_attempt_failed" as const,
    rooms: BASE.rooms,
    bookerName: "Jane Exhibitor",
    bookerEmail: "jane@example.com",
    amountHt: 72000,
    currency: "EUR",
    adminUrl: BASE.adminUrl,
    holdUntilLabel: "14:35 TRT",
    declineMessage: "Your card was declined.",
  };

  it("tells the desk what to do, not just what the buyer saw", () => {
    const { body, html } = failureNotification({
      ...BASE_FAIL,
      decline: {
        reason: "The card has no room left — funds or limit.",
        nextStep: "They need another card.",
        tellBuyer: true,
        card: "Visa ···· 0002 · FR · credit",
        codes: "card_declined / insufficient_funds",
      },
    });
    for (const text of [body, html]) {
      expect(text).toContain("no room left");
      expect(text).toContain("They need another card.");
      expect(text).toContain("card_declined / insufficient_funds");
    }
    expect(html).toContain("···· 0002");
  });

  it("warns, loudly, when the reason must not reach the buyer", () => {
    const { body, html } = failureNotification({
      ...BASE_FAIL,
      decline: {
        reason: "The card was blocked as lost, stolen or fraudulent.",
        nextStep: "Internal only — do not repeat this reason to the buyer.",
        tellBuyer: false,
        card: null,
        codes: "card_declined / stolen_card",
      },
    });
    expect(body).toContain("DO NOT REPEAT THE REASON ABOVE TO THE BUYER.");
    expect(html).toContain("Do not repeat the reason above to the buyer.");
  });

  it("stays quiet when Stripe explained nothing", () => {
    const { body, html } = failureNotification({ ...BASE_FAIL, declineMessage: null, decline: null });
    expect(body).not.toContain("Next step");
    expect(html).not.toContain("Next step");
    expect(body).not.toContain("DO NOT REPEAT");
  });
});

describe("the opening and the next step must not contradict each other", () => {
  const FAIL = {
    orderUid: BASE.orderUid,
    reason: "payment_attempt_failed" as const,
    rooms: BASE.rooms,
    amountHt: 72000,
    currency: "EUR",
    adminUrl: BASE.adminUrl,
    holdUntilLabel: "14:35 TRT",
  };

  it("does not invite a call on a card blocked as stolen", () => {
    const { body } = failureNotification({
      ...FAIL,
      decline: {
        reason: "The card was blocked as lost, stolen or fraudulent.",
        nextStep: "Do not chase the sale.",
        tellBuyer: false,
        card: null,
        codes: "card_declined / stolen_card",
      },
    });
    expect(body).not.toContain("Worth a call");
    expect(body).toContain("Do not chase the sale.");
  });

  it("still invites a call on an ordinary decline", () => {
    expect(failureNotification(FAIL).body).toContain("Worth a call");
  });
});

/**
 * The second mail, and why there is one at all.
 *
 * A buyer whose card is refused tries another card — they do not start a new
 * booking. Every attempt after the first used to be silent, so if the first
 * failed for something ordinary and a later one was refused as stolen, the desk
 * had been told to call the buyer back and heard nothing since.
 */
describe("a decline that overrules an earlier alert", () => {
  const STOLEN = {
    orderUid: BASE.orderUid,
    reason: "payment_attempt_failed" as const,
    rooms: BASE.rooms,
    bookerName: "Jane Exhibitor",
    bookerEmail: "jane@example.com",
    amountHt: 72000,
    currency: "EUR",
    adminUrl: BASE.adminUrl,
    holdUntilLabel: "14:35 TRT",
    declineMessage: "Your card was declined.",
    decline: {
      reason: "The card was blocked as lost, stolen or fraudulent.",
      nextStep: "Do not chase the sale.",
      tellBuyer: false,
      card: null,
      codes: "card_declined / stolen_card",
    },
    supersedesEarlierNotice: true,
  };

  it("says outright that the earlier advice was wrong", () => {
    const { body, html } = failureNotification(STOLEN);
    for (const text of [body, html]) {
      expect(text).toContain("Disregard it");
    }
    expect(body).toContain("*** CORRECTION ***");
  });

  it("carries a subject that cannot be mistaken for the first mail", () => {
    // Two mails with one subject read as a duplicate and go unopened, which
    // would defeat the whole point of sending the second.
    const first = failureNotification({ ...STOLEN, supersedesEarlierNotice: false }).subject;
    const second = failureNotification(STOLEN).subject;
    expect(second).not.toBe(first);
    expect(second).toContain("the earlier alert was wrong");
  });

  it("still carries the warning not to repeat the reason to the buyer", () => {
    const { html } = failureNotification(STOLEN);
    expect(html).toContain("Do not repeat the reason above to the buyer.");
  });

  it("says nothing of the sort when it is the first alert", () => {
    const { body, html } = failureNotification({ ...STOLEN, supersedesEarlierNotice: false });
    expect(body).not.toContain("Disregard");
    expect(html).not.toContain("Disregard");
  });
});

describe("refundNotification", () => {
  const REFUND = {
    orderUid: "2fe0f775-7681-4cb1-a0c3-b21dac06219d",
    rooms: [SUITE_1],
    bookerName: "Jane Exhibitor",
    bookerEmail: "jane@example.com",
    amountRefunded: 87120,
    currency: "EUR",
    invoiceNumber: "NE26-2026-0007",
    creditNoteNumber: "NE26-CN-2026-0001",
    adminUrl: "https://rooms.vo-eu.be/rooms/admin",
  };

  it("says the rooms are back on sale, which is the part acted on", () => {
    // The desk counted this room as sold. Without this line the first they hear
    // of it is the room turning up free again, which during a three-day event
    // is how one room gets promised twice.
    const { body, html } = refundNotification(REFUND);
    for (const text of [body, html]) {
      expect(text).toContain("back on sale");
    }
  });

  it("prints money as money", () => {
    // The original team mails announced an 871.20 EUR sale as "87120 EUR".
    const { subject, body } = refundNotification(REFUND);
    expect(subject).toContain("871.20 EUR");
    expect(body).toContain("871.20 EUR");
    expect(body).not.toContain("87120");
  });

  it("names both documents, so the pair can be found in the accounts", () => {
    const { body } = refundNotification(REFUND);
    expect(body).toContain("NE26-2026-0007");
    expect(body).toContain("NE26-CN-2026-0001");
  });

  it("names the room in the subject and counts them when there are several", () => {
    expect(refundNotification(REFUND).subject).toContain("Suite 1");
    const many = { ...REFUND, rooms: [SUITE_1, { ...SUITE_1, roomName: "Suite 2" }] };
    expect(refundNotification(many).subject).toContain("2 rooms");
  });

  it("cannot be mistaken for the sale it cancels", () => {
    const sold = saleNotification(BASE).subject;
    const refunded = refundNotification(REFUND).subject;
    expect(refunded).not.toBe(sold);
    expect(refunded).toContain("Refunded");
  });

  it("copes with an exhibitor who gave no name", () => {
    const { body, html } = refundNotification({ ...REFUND, bookerName: "  ", bookerEmail: null });
    for (const text of [body, html]) {
      expect(text).toContain("An exhibitor");
    }
  });
});
