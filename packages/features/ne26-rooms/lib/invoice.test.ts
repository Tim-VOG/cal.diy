import { describe, expect, it } from "vitest";
import { buildInvoiceModel } from "./invoice";

describe("buildInvoiceModel (HT prices, VAT added on top)", () => {
  it("adds 21% VAT on top of a room-only HT total", () => {
    const m = buildInvoiceModel({
      amountTotal: 35000, // HT
      currency: "EUR",
      roomName: "Suite 1",
      durationMinutes: 60,
      addOns: [],
    });
    expect(m.totalHt).toBe(35000);
    expect(m.totalVat).toBe(7350); // 35000 * 21%
    expect(m.totalTtc).toBe(42350); // HT + VAT
    expect(m.vatBreakdown).toEqual([{ vatRate: 2100, base: 35000, vat: 7350 }]);
  });

  it("computes VAT per rate with add-ons (room 21%, catering 12%)", () => {
    const m = buildInvoiceModel({
      amountTotal: 42000, // 35000 room HT + 7000 catering HT
      currency: "EUR",
      roomName: "Suite 1",
      durationMinutes: 60,
      addOns: [{ name: "Catering - Lunch", quantity: 2, lineTotal: 7000, vatRate: 1200 }],
    });
    expect(m.totalHt).toBe(42000);
    // room: 35000 * 21% = 7350 ; catering: 7000 * 12% = 840
    expect(m.totalVat).toBe(7350 + 840);
    expect(m.totalTtc).toBe(42000 + 8190);
    expect(m.lines).toHaveLength(2);
    expect(m.lines[1].label).toBe("Catering - Lunch × 2");
    expect(m.vatBreakdown).toEqual([
      { vatRate: 1200, base: 7000, vat: 840 },
      { vatRate: 2100, base: 35000, vat: 7350 },
    ]);
  });

  it("zero-rates every line and carries the mention when reverse-charged", () => {
    const m = buildInvoiceModel(
      { amountTotal: 35000, currency: "EUR", roomName: "Suite 1", durationMinutes: 60, addOns: [] },
      { zeroRated: true, mention: "VAT reverse charge" }
    );
    expect(m.totalHt).toBe(35000);
    expect(m.totalVat).toBe(0);
    expect(m.totalTtc).toBe(35000); // no VAT added
    expect(m.lines.every((l) => l.vatRate === 0 && l.vat === 0)).toBe(true);
    expect(m.vatMention).toBe("VAT reverse charge");
  });
});

describe("buildInvoiceModel — the room VAT rate is an input, not a constant", () => {
  it("applies the rate it is given rather than the current default", () => {
    // Re-rendering an issued document must use the rate FROZEN on the booking, so
    // correcting the default later cannot alter a document already sent out.
    const m = buildInvoiceModel({
      amountTotal: 10000,
      currency: "EUR",
      roomName: "Suite 1",
      durationMinutes: 60,
      addOns: [],
      roomVatRate: 1200,
    });
    expect(m.lines[0].vatRate).toBe(1200);
    expect(m.lines[0].ht).toBe(10000);
    expect(m.totalVat).toBe(1200); // 12% added on top of HT
    expect(m.totalTtc).toBe(11200);
  });

  it("falls back to the default room rate when none is frozen", () => {
    const m = buildInvoiceModel({
      amountTotal: 10000,
      currency: "EUR",
      roomName: "Suite 1",
      durationMinutes: 60,
      addOns: [],
    });
    expect(m.lines[0].vatRate).toBe(2100);
    expect(m.totalVat).toBe(2100);
  });
});
