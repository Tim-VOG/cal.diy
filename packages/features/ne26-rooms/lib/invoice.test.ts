import { describe, expect, it } from "vitest";

import { buildInvoiceModel } from "./invoice";

describe("buildInvoiceModel", () => {
  it("derives HT/VAT from a VAT-inclusive room-only total (21%)", () => {
    const m = buildInvoiceModel({ amountTotal: 35000, currency: "EUR", roomName: "Suite 1", durationMinutes: 60, addOns: [] });
    expect(m.totalTtc).toBe(35000);
    // 35000 / 1.21 = 28925.6 -> 28926 HT, 6074 VAT
    expect(m.totalHt).toBe(28926);
    expect(m.totalVat).toBe(35000 - 28926);
    expect(m.totalHt + m.totalVat).toBe(m.totalTtc);
    expect(m.vatBreakdown).toEqual([{ vatRate: 2100, base: 28926, vat: 6074 }]);
  });

  it("keeps the total equal to amountTotal and splits VAT per rate with add-ons", () => {
    const m = buildInvoiceModel({
      amountTotal: 42000, // 350 room + 70 catering
      currency: "EUR",
      roomName: "Suite 1",
      durationMinutes: 60,
      addOns: [{ name: "Catering - Lunch", quantity: 2, lineTotal: 7000, vatRate: 1200 }],
    });
    expect(m.totalTtc).toBe(42000);
    expect(m.totalHt + m.totalVat).toBe(42000);
    expect(m.lines).toHaveLength(2);
    expect(m.lines[1].label).toBe("Catering - Lunch × 2");
    // two distinct VAT rates present
    expect(m.vatBreakdown.map((v) => v.vatRate)).toEqual([1200, 2100]);
  });

  it("zero-rates every line and carries the mention when reverse-charged", () => {
    const m = buildInvoiceModel(
      { amountTotal: 35000, currency: "EUR", roomName: "Suite 1", durationMinutes: 60, addOns: [] },
      { zeroRated: true, mention: "VAT reverse charge" }
    );
    expect(m.totalTtc).toBe(35000);
    expect(m.totalHt).toBe(35000); // HT == amount paid, no VAT
    expect(m.totalVat).toBe(0);
    expect(m.lines.every((l) => l.vatRate === 0 && l.vat === 0)).toBe(true);
    expect(m.vatMention).toBe("VAT reverse charge");
  });
});
