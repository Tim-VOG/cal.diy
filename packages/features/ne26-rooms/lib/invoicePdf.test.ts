import { describe, expect, it } from "vitest";
import { buildInvoiceModel } from "./invoice";
import { renderInvoicePdf, toPdfText } from "./invoicePdf";

describe("renderInvoicePdf", () => {
  it("produces a valid, non-trivial PDF", async () => {
    const model = buildInvoiceModel({
      amountTotal: 42000,
      currency: "EUR",
      roomName: "Suite 1",
      durationMinutes: 120,
      addOns: [{ name: "Catering - Lunch", quantity: 2, lineTotal: 7000, vatRate: 1200 }],
    });
    const bytes = await renderInvoicePdf(
      model,
      {
        invoiceNumber: "NE26-2026-0001",
        issueDate: new Date("2026-06-04T10:00:00.000Z"),
        bookerName: "Jane Exhibitor",
        bookerEmail: "jane@example.com",
        roomName: "Suite 1",
        startUtc: new Date("2026-11-17T13:00:00.000Z"),
        endUtc: new Date("2026-11-17T15:00:00.000Z"),
      },
      {
        legalName: "VO EUROPE SA",
        vatNumber: "BE 0123.456.789",
        addressLine1: "Rue Example 1",
        addressLine2: "",
        postalCode: "1000",
        city: "Brussels",
        country: "Belgium",
        iban: "BE00 0000 0000 0000",
        bic: "GEBABEBB",
        legalFooter: "",
        footerColumn1: "",
        footerColumn2: "",
        footerColumn3: "",
      }
    );

    expect(new TextDecoder().decode(bytes.slice(0, 5))).toBe("%PDF-");
    expect(bytes.length).toBeGreaterThan(1500);
  });

  it("renders a credit note variant", async () => {
    const model = buildInvoiceModel({
      amountTotal: 42000,
      currency: "EUR",
      roomName: "Suite 1",
      durationMinutes: 120,
      addOns: [],
    });
    const bytes = await renderInvoicePdf(
      model,
      {
        invoiceNumber: "NE26-CN-2026-0001",
        relatedInvoiceNumber: "NE26-2026-0001",
        kind: "credit_note",
        issueDate: new Date("2026-06-04T10:00:00.000Z"),
        bookerName: "Jane Exhibitor",
        bookerEmail: "jane@example.com",
        roomName: "Suite 1",
        startUtc: new Date("2026-11-17T13:00:00.000Z"),
        endUtc: new Date("2026-11-17T15:00:00.000Z"),
      },
      {
        legalName: "VO EUROPE SA",
        vatNumber: "BE 0123.456.789",
        addressLine1: "Rue Example 1",
        addressLine2: "",
        postalCode: "1000",
        city: "Brussels",
        country: "Belgium",
        iban: "BE00 0000 0000 0000",
        bic: "GEBABEBB",
        legalFooter: "",
        footerColumn1: "",
        footerColumn2: "",
        footerColumn3: "",
      }
    );

    expect(new TextDecoder().decode(bytes.slice(0, 5))).toBe("%PDF-");
    expect(bytes.length).toBeGreaterThan(1500);
  });

  it("renders a three-column, multi-line footer", async () => {
    const model = buildInvoiceModel({
      amountTotal: 42000,
      currency: "EUR",
      roomName: "Suite 1",
      durationMinutes: 120,
      addOns: [],
    });
    const bytes = await renderInvoicePdf(
      model,
      {
        invoiceNumber: "NE26-2026-0002",
        issueDate: new Date("2026-06-04T10:00:00.000Z"),
        bookerName: "Jane Exhibitor",
        bookerEmail: "jane@example.com",
        roomName: "Suite 1",
        startUtc: new Date("2026-11-17T13:00:00.000Z"),
        endUtc: new Date("2026-11-17T15:00:00.000Z"),
      },
      {
        legalName: "VO EUROPE SA",
        vatNumber: "BE 0123.456.789",
        addressLine1: "Rue Example 1",
        addressLine2: "",
        postalCode: "1000",
        city: "Brussels",
        country: "Belgium",
        iban: "BE00 0000 0000 0000",
        bic: "GEBABEBB",
        legalFooter: "",
        footerColumn1: "VO EUROPE SA\nRue Example 1\n1000 Brussels",
        footerColumn2: "VAT BE0123.456.789\nRPM Brussels",
        footerColumn3: "Contact\nsales@vo-europe.eu",
      }
    );

    expect(new TextDecoder().decode(bytes.slice(0, 5))).toBe("%PDF-");
    expect(bytes.length).toBeGreaterThan(1500);
  });
});

describe("toPdfText — legal names must survive the PDF fonts", () => {
  it("transliterates accents instead of deleting them", () => {
    // These went out on Belgian VAT invoices to international NATO exhibitors as
    // "Mller Verteidigungstechnik" and "Socit Gnrale".
    expect(toPdfText("Müller Verteidigungstechnik GmbH")).toBe("Muller Verteidigungstechnik GmbH");
    expect(toPdfText("Société Générale")).toBe("Societe Generale");
  });

  it("handles Latin letters that have no combining form", () => {
    expect(toPdfText("Straße")).toBe("Strasse");
    expect(toPdfText("Ørsted A/S")).toBe("Orsted A/S");
    expect(toPdfText("Cœur de Lion")).toBe("Coeur de Lion");
  });

  it("leaves plain ASCII untouched", () => {
    expect(toPdfText("VO EUROPE SA")).toBe("VO EUROPE SA");
  });

  it("marks undrawable scripts rather than silently dropping them", () => {
    // '?' is wrong but visible. A deletion looks like a correct invoice made out
    // to a company with no name.
    expect(toPdfText("東京商事")).toBe("????");
  });

  it("normalises the typographic punctuation the app itself emits", () => {
    expect(toPdfText("Suite 1 — rental × 2")).toBe("Suite 1 - rental x 2");
  });
});
