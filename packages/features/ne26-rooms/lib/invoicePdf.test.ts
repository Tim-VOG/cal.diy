import { describe, expect, it } from "vitest";

import { buildInvoiceModel } from "./invoice";
import { renderInvoicePdf } from "./invoicePdf";

describe("renderInvoicePdf", () => {
  it("produces a valid, non-trivial PDF", async () => {
    const model = buildInvoiceModel({
      amountTotal: 42000,
      currency: "EUR",
      roomName: "Suite 1",
      durationMinutes: 120,
      addOns: [{ name: "Catering - Lunch", quantity: 2, lineTotal: 7000, vatRate: 1200 }],
    });
    const bytes = await renderInvoicePdf(model, {
      invoiceNumber: "NE26-2026-0001",
      issueDate: new Date("2026-06-04T10:00:00.000Z"),
      bookerName: "Jane Exhibitor",
      bookerEmail: "jane@example.com",
      roomName: "Suite 1",
      startUtc: new Date("2026-11-17T13:00:00.000Z"),
      endUtc: new Date("2026-11-17T15:00:00.000Z"),
    });

    expect(new TextDecoder().decode(bytes.slice(0, 5))).toBe("%PDF-");
    expect(bytes.length).toBeGreaterThan(1500);
  });
});
