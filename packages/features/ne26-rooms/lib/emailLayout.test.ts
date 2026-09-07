import { describe, expect, it } from "vitest";
import { button, escapeHtml, linkList, roomBlock, textToHtml } from "./emailLayout";

describe("escapeHtml", () => {
  it("closes the obvious hole", () => {
    // Buyer names go straight into these mails.
    expect(escapeHtml('<script>"&')).toBe("&lt;script&gt;&quot;&amp;");
  });
});

describe("roomBlock", () => {
  const ROOM = {
    roomName: "Suite <1>",
    slotLabel: "Tue, 17 Nov 2026, 16:00-18:00 TRT",
    durationMinutes: 120,
    amountLabel: "720.00 EUR",
    addOns: [{ name: "Catering & Lunch", quantity: 2, lineLabel: "140.00 EUR" }],
  };

  it("escapes everything that came from a buyer", () => {
    const html = roomBlock(ROOM);
    expect(html).toContain("Suite &lt;1&gt;");
    expect(html).toContain("Catering &amp; Lunch");
    expect(html).not.toContain("<1>");
  });

  it("shows the hours, the slot and the add-ons", () => {
    const html = roomBlock(ROOM);
    expect(html).toContain("2h");
    expect(html).toContain("Tue, 17 Nov 2026, 16:00-18:00 TRT");
    expect(html).toContain("&times; 2");
    expect(html).toContain("720.00 EUR");
  });

  it("leaves the amount out when there is none to show", () => {
    // The team mails carry an order total, not a price per room.
    expect(roomBlock({ ...ROOM, amountLabel: undefined })).not.toContain("720.00 EUR");
  });
});

describe("linkList", () => {
  it("drops a link with no destination rather than printing a dead one", () => {
    const html = linkList([
      { label: "Admin", href: "https://rooms.vo-eu.be/rooms/admin" },
      { label: "Stripe", href: "" },
    ]);
    expect(html).toContain("Admin");
    expect(html).not.toContain("Stripe");
  });

  it("is nothing at all when there is nothing to link to", () => {
    expect(linkList([{ label: "Stripe", href: "" }])).toBe("");
  });
});

describe("button", () => {
  it("survives a client that drops background colours", () => {
    // The colour lives on the cell, not the link, so the label is still visible
    // and still clickable when Outlook throws the background away.
    const html = button("Finish the payment", "https://pay.example.com/x?a=1&b=2");
    expect(html).toContain('href="https://pay.example.com/x?a=1&amp;b=2"');
    expect(html).toContain("Finish the payment");
  });
});

describe("textToHtml", () => {
  it("makes the dashboard link clickable, which is all the reader wants", () => {
    const html = textToHtml("Refund this in Stripe.\n\nhttps://rooms.vo-eu.be/rooms/admin");
    expect(html).toContain('<a href="https://rooms.vo-eu.be/rooms/admin"');
  });

  it("keeps the line breaks the alert was written with", () => {
    const html = textToHtml("Captured 350.00 EUR\nPayment intent: pi_123\n\nNo matching order.");
    expect(html).toContain("Captured 350.00 EUR<br/>Payment intent: pi_123");
    expect((html.match(/<p /g) ?? []).length).toBe(2);
  });

  it("escapes the text around a link too", () => {
    expect(textToHtml("<b>hi</b> https://x.test")).toContain("&lt;b&gt;hi&lt;/b&gt;");
  });
});
