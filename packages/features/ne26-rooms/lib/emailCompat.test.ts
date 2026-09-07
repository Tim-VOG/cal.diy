import { describe, expect, it } from "vitest";
import { button, card, emailShell, factRows, roomBlock, signOff, totalRow } from "./emailLayout";
import { failureNotification, saleNotification } from "./teamNotification";

/**
 * What a mail client will do to these, checked without a mail client.
 *
 * Rendering in Outlook and Gmail is not something this can prove — that needs a
 * real inbox. What it can prove is that the markup stays inside the rules those
 * clients are known to break, which is where the failures come from: a flex
 * layout that collapses into a column, a background colour dropped from a link
 * so the only button on the page disappears, a message long enough that Gmail
 * hides the end of it behind "view entire message".
 */

const SUITE = {
  roomName: "Suite 1",
  startUtc: new Date("2026-11-17T13:00:00.000Z"),
  endUtc: new Date("2026-11-17T15:00:00.000Z"),
  durationMinutes: 120,
  addOns: [{ name: "Catering - Lunch", quantity: 2, lineTotal: 14000 }],
};

const sale = saleNotification({
  orderUid: "2fe0f775-7681-4cb1-a0c3-b21dac06219d",
  rooms: [SUITE, SUITE, SUITE],
  bookerName: "Jane Exhibitor",
  bookerEmail: "jane@example.com",
  bookerCountry: "FR",
  bookerVatNumber: "FR12345678901",
  amountHt: 216000,
  amountPaid: 261360,
  currency: "EUR",
  invoiceNumber: "NE26-2026-0007",
  stripeUrl: "https://dashboard.stripe.com/test/payments/pi_123",
  adminUrl: "https://rooms.vo-eu.be/rooms/admin",
});

const decline = failureNotification({
  orderUid: "2fe0f775-7681-4cb1-a0c3-b21dac06219d",
  reason: "payment_attempt_failed",
  rooms: [SUITE],
  bookerName: "Jane Exhibitor",
  bookerEmail: "jane@example.com",
  amountHt: 72000,
  currency: "EUR",
  adminUrl: "https://rooms.vo-eu.be/rooms/admin",
  holdUntilLabel: "14:35 TRT",
  declineMessage: "Your card was declined.",
  decline: {
    reason: "The card has no room left — funds or limit.",
    nextStep: "They need another card.",
    tellBuyer: true,
    card: "Visa ···· 0002 · FR · credit",
    codes: "card_declined / insufficient_funds",
  },
});

const pieces = [
  emailShell("<p>x</p>"),
  card("<p>x</p>"),
  roomBlock({
    roomName: "Suite 1",
    slotLabel: "Tue, 17 Nov 2026, 16:00-18:00 TRT",
    durationMinutes: 120,
    amountLabel: "720.00 EUR",
    addOns: [{ name: "Lunch", quantity: 2, lineLabel: "140.00 EUR" }],
  }),
  factRows([{ label: "Buyer", value: "Jane" }]),
  totalRow("Total paid", "871.20 EUR"),
  button("Pay", "https://example.com"),
  signOff("footer"),
  sale.html,
  decline.html,
];

describe("nothing an email client silently drops", () => {
  it("uses no flex or grid layout", () => {
    // Outlook's Word renderer ignores both, and a two-column row laid out with
    // flex collapses into a stack with the amounts under the room names.
    for (const html of pieces) {
      expect(html).not.toMatch(/display\s*:\s*(flex|grid|inline-flex)/);
    }
  });

  it("uses no external stylesheet, class or style block", () => {
    // Gmail strips <style> from the body and nothing here can rely on classes.
    for (const html of pieces) {
      expect(html).not.toContain("<style");
      expect(html).not.toContain("class=");
      expect(html).not.toContain("<link");
    }
  });

  it("never puts the only call to action's colour on the link itself", () => {
    // Outlook drops background-color on <a>. The colour has to live on the
    // table cell, or a buyer with twenty minutes left on a hold sees nothing to
    // click. This asserts the shape that survives, not the appearance.
    const html = button("Finish the payment", "https://example.com/pay");
    const anchor = html.slice(html.indexOf("<a "), html.indexOf("</a>"));
    expect(anchor).not.toContain("background");
    expect(html).toContain("background:#000643");
    expect(html).toContain("<td");
  });

  it("uses no image, so a blocked-images inbox loses nothing", () => {
    for (const html of pieces) {
      expect(html).not.toContain("<img");
      expect(html).not.toMatch(/background-image/);
    }
  });

  it("stays well under Gmail's clipping threshold", () => {
    // Past ~102KB Gmail hides the rest behind "view entire message", which for
    // the sales desk would cut off the links at the bottom.
    for (const html of [sale.html, decline.html]) {
      expect(new TextEncoder().encode(html).length).toBeLessThan(60_000);
    }
  });

  it("closes every tag it opens", () => {
    // A stray unclosed <td> is the classic way a table mail renders as one long
    // column in Outlook while looking correct everywhere else.
    for (const html of pieces) {
      for (const tag of ["table", "tr", "td", "div", "p", "a"]) {
        const open = (html.match(new RegExp(`<${tag}[\\s>]`, "g")) ?? []).length;
        const close = (html.match(new RegExp(`</${tag}>`, "g")) ?? []).length;
        expect(close, `${tag} in ${html.slice(0, 60)}`).toBe(open);
      }
    }
  });

  it("gives every table the attributes Outlook needs to not add its own spacing", () => {
    for (const html of pieces) {
      for (const table of html.match(/<table[^>]*>/g) ?? []) {
        expect(table).toContain("cellpadding=");
        expect(table).toContain("cellspacing=");
        expect(table).toContain("border-collapse");
      }
    }
  });
});
