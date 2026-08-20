// @vitest-environment node
//
// Node, not jsdom: pdf-lib rejects a Buffer created in another realm, so under
// jsdom every embedPng() here silently took the text fallback and the logo path
// was never actually tested.
import { PDFDocument } from "pdf-lib";
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
    // This one shipped: the bank line printed "IBAN BE00 ... ? BIC GEBABEBB".
    expect(toPdfText("IBAN BE00 0000 · BIC GEBABEBB")).toBe("IBAN BE00 0000 - BIC GEBABEBB");
    expect(toPdfText("Loading…")).toBe("Loading...");
    // Non-breaking and thin spaces come in from formatted numbers and addresses.
    expect(toPdfText("1\u00a0000 EUR")).toBe("1 000 EUR");
  });
});

describe("renderInvoicePdf — layout limits", () => {
  const ISSUER = {
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
  };
  const META = {
    invoiceNumber: "NE26-2026-0100",
    issueDate: new Date("2026-11-17T09:00:00.000Z"),
    bookerName: "Jane Exhibitor",
    bookerEmail: "jane@example.com",
    roomName: "Suite 1",
    startUtc: new Date("2026-11-17T13:00:00.000Z"),
    endUtc: new Date("2026-11-17T15:00:00.000Z"),
  };

  it("spills a long add-on list onto another page instead of over the footer", async () => {
    const addOns = Array.from({ length: 40 }, (_, i) => ({
      name: `Add-on ${i + 1}`,
      quantity: 1,
      lineTotal: 1000,
      vatRate: 2100,
    }));
    const model = buildInvoiceModel({
      amountTotal: 60000,
      currency: "EUR",
      roomName: "Suite 1",
      durationMinutes: 120,
      addOns,
    });

    const bytes = await renderInvoicePdf(model, META, ISSUER);
    const pageCount = (await PDFDocument.load(bytes)).getPageCount();
    expect(pageCount).toBeGreaterThan(1);
  });

  it("stays on one page for an ordinary booking", async () => {
    const model = buildInvoiceModel({
      amountTotal: 60000,
      currency: "EUR",
      roomName: "Suite 1",
      durationMinutes: 120,
      addOns: [{ name: "Catering", quantity: 8, lineTotal: 12000, vatRate: 600 }],
    });

    const bytes = await renderInvoicePdf(model, META, ISSUER);
    expect((await PDFDocument.load(bytes)).getPageCount()).toBe(1);
  });

  it("embeds the logo rather than falling back to text", async () => {
    const model = buildInvoiceModel({
      amountTotal: 60000,
      currency: "EUR",
      roomName: "Suite 1",
      durationMinutes: 60,
      addOns: [],
    });
    const bytes = await renderInvoicePdf(model, META, ISSUER);
    // The fallback draws text only; an embedded PNG makes the file much larger.
    expect(bytes.length).toBeGreaterThan(10000);
  });
});
