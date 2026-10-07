import { describe, expect, it } from "vitest";
import { ACCOUNTING_HEADERS, accountingRows, fmtStamp } from "./accountingExport";

const ORDER = {
  orderNumber: 9,
  invoiceNumber: "NE26-2026-0001",
  invoiceIssuedAt: new Date("2026-09-23T10:12:00.000Z"),
  creditNoteNumber: null,
  creditNoteIssuedAt: null,
  bookerName: "Jane Doe",
  bookerEmail: "jane@example.com",
  bookerLegalName: "ACME Defence SA",
  bookerVatNumber: "BE0898188425",
  bookerCountry: "BE",
  bookerPoNumber: "4471",
  bookerInternalReference: null,
  currency: "EUR",
  roomVatRate: 2100,
  vatZeroRated: false,
  vatMention: null,
  stripePaymentId: "pi_123",
  paidAt: new Date("2026-09-23T10:11:00.000Z"),
  createdAt: new Date("2026-09-23T10:00:00.000Z"),
  bookings: [
    {
      durationMinutes: 120,
      amountTotal: 60000,
      resource: { name: "Suite 1" },
      addOns: [],
    },
  ],
  creditNotes: [] as {
    number: string;
    issuedAt: Date;
    amountHt: number;
    amountVat: number;
    amountTtc: number;
    currency: string;
    rooms: string[];
  }[],
};

const column = (row: (string | number | null)[], header: string) => row[ACCOUNTING_HEADERS.indexOf(header)];

describe("accountingRows", () => {
  it("books one row per document, in whole units, with the frozen VAT", () => {
    const [row] = accountingRows([ORDER]);
    expect(column(row, "Document")).toBe("NE26-2026-0001");
    expect(column(row, "Type")).toBe("Invoice");
    expect(column(row, "Order")).toBe("NE26-ORD-0009");
    expect(column(row, "Company")).toBe("ACME Defence SA");
    expect(column(row, "VAT number")).toBe("BE0898188425");
    expect(column(row, "Excl. VAT")).toBe(600);
    expect(column(row, "VAT rate")).toBe("21");
    expect(column(row, "VAT")).toBe(126);
    expect(column(row, "Incl. VAT")).toBe(726);
    expect(column(row, "Room-hours")).toBe(2);
    expect(column(row, "Settled")).toBe("Stripe");
  });

  it("prints a zero-rated sale at 0% with its legal mention", () => {
    const [row] = accountingRows([
      { ...ORDER, vatZeroRated: true, vatMention: "Reverse charge", bookerCountry: "NL" },
    ]);
    expect(column(row, "VAT rate")).toBe(0);
    expect(column(row, "VAT")).toBe(0);
    expect(column(row, "Incl. VAT")).toBe(600);
    expect(column(row, "VAT mention")).toBe("Reverse charge");
  });

  it("gives a credit note the same amounts with the sign flipped, so the pair nets to zero", () => {
    const rows = accountingRows([
      {
        ...ORDER,
        creditNoteNumber: "NE26-CN-2026-0001",
        creditNoteIssuedAt: new Date("2026-09-24T08:00:00.000Z"),
        creditNotes: [
          {
            number: "NE26-CN-2026-0001",
            issuedAt: new Date("2026-09-24T08:00:00.000Z"),
            amountHt: 60000,
            amountVat: 12600,
            amountTtc: 72600,
            currency: "EUR",
            rooms: ["Suite 1"],
          },
        ],
      },
    ]);
    expect(rows).toHaveLength(2);
    const [invoice, credit] = rows;
    expect(column(credit, "Type")).toBe("Credit note");
    expect(column(credit, "Cancels invoice")).toBe("NE26-2026-0001");
    expect(Number(column(credit, "Incl. VAT")) + Number(column(invoice, "Incl. VAT"))).toBe(0);
    // A credit note books an amount, not hours: it may cover one room of three.
    expect(column(credit, "Room-hours")).toBe("");
  });

  it("dates every stamp in event time", () => {
    // 10:12 UTC is 13:12 in Istanbul, which is when the document says it was issued.
    expect(fmtStamp(new Date("2026-09-23T10:12:00.000Z"))).toBe("23/09/2026 13:12");
    expect(fmtStamp(null)).toBe("");
  });

  it("skips an order that has no document at all", () => {
    expect(accountingRows([{ ...ORDER, invoiceNumber: null }])).toEqual([]);
  });
});
