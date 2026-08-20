import { describe, expect, it } from "vitest";
import { formatMoney, saleNotification } from "./teamNotification";

const BASE = {
  bookingUid: "2fe0f775-7681-4cb1-a0c3-b21dac06219d",
  roomName: "Suite 1",
  startUtc: new Date("2026-11-17T13:00:00.000Z"),
  endUtc: new Date("2026-11-17T15:00:00.000Z"),
  durationMinutes: 120,
  bookerName: "Jane Exhibitor",
  bookerEmail: "jane@example.com",
  bookerCountry: "FR",
  bookerVatNumber: "FR12345678901",
  addOns: [{ name: "Catering - Lunch", quantity: 2, lineTotal: 14000 }],
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

  it("carries the slot in Brussels time, not UTC", () => {
    // 13:00 UTC in November is 14:00 in Brussels.
    expect(saleNotification(BASE).body).toContain("Tue, 17 Nov 2026, 14:00-16:00 (Europe/Brussels)");
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
      addOns: [],
      bookerVatNumber: null,
      bookerCountry: null,
      invoiceNumber: null,
      amountPaid: null,
    });
    expect(subject).toBe("Room sold — Suite 1, 2h");
    expect(body).not.toContain("Add-ons");
    expect(body).not.toContain("Invoice:");
    expect(body).toContain("720.00 EUR");
  });

  it("falls back to a neutral buyer label rather than printing 'null'", () => {
    const { body } = saleNotification({ ...BASE, bookerName: null, bookerEmail: null });
    expect(body).toContain("An exhibitor");
    expect(body).not.toContain("null");
  });
});
