import { PDFDocument, rgb, StandardFonts } from "pdf-lib";
import type { InvoiceModel } from "./invoice";
import { INVOICE_LOGO_PNG_BASE64, INVOICE_LOGO_PNG_HEIGHT, INVOICE_LOGO_PNG_WIDTH } from "./invoiceLogo";

const TZ = "Europe/Brussels";
const NAVY = rgb(0, 6 / 255, 67 / 255); // #000643
const GREY = rgb(0.42, 0.42, 0.45);

export interface InvoiceMeta {
  invoiceNumber: string;
  issueDate: Date;
  bookerName: string;
  bookerEmail: string;
  roomName: string;
  startUtc: Date;
  endUtc: Date;
  /** "invoice" (default) or "credit_note" — flips the title and negates amounts. */
  kind?: "invoice" | "credit_note";
  /** For a credit note: the invoice number it cancels. */
  relatedInvoiceNumber?: string;
  /** Customer billing details for the "Bill to" block (legal name + address). */
  billTo?: {
    legalName?: string | null;
    addressLine1?: string | null;
    addressLine2?: string | null;
    postalCode?: string | null;
    city?: string | null;
    country?: string | null;
    vatNumber?: string | null;
  };
}

export interface InvoiceIssuer {
  legalName: string;
  vatNumber: string;
  addressLine1: string;
  addressLine2: string;
  postalCode: string;
  city: string;
  country: string;
  iban: string;
  bic: string;
  legalFooter: string;
  footerColumn1: string;
  footerColumn2: string;
  footerColumn3: string;
}

// pdf-lib's standard fonts use WinAnsi; keep text to safe characters.
function ascii(s: string): string {
  return s
    .replace(/—|–/g, "-")
    .replace(/×/g, "x")
    .replace(/[^\x20-\x7E]/g, "");
}
function money(cents: number, currency: string): string {
  return `${(cents / 100).toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currency}`;
}
function pct(bp: number): string {
  return `${bp / 100}%`;
}
function dt(d: Date): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: TZ,
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(d);
}

export async function renderInvoicePdf(
  model: InvoiceModel,
  meta: InvoiceMeta,
  issuer: InvoiceIssuer
): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([595, 842]); // A4
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const { width } = page.getSize();
  const left = 50;
  const right = width - 50;
  let y = 792;

  const text = (s: string, x: number, yy: number, size = 10, f = font, color = rgb(0, 0, 0)) =>
    page.drawText(ascii(s), { x, y: yy, size, font: f, color });
  const textRight = (s: string, xRight: number, yy: number, size = 10, f = font, color = rgb(0, 0, 0)) =>
    page.drawText(ascii(s), { x: xRight - f.widthOfTextAtSize(ascii(s), size), y: yy, size, font: f, color });

  // A credit note shows the same breakdown with negated amounts.
  const isCredit = meta.kind === "credit_note";
  const amt = (cents: number) => money(isCredit ? -cents : cents, model.currency);

  // Header — logo top-left (text fallback if the image can't embed), meta top-right
  const logoW = 130;
  const logoH = (logoW * INVOICE_LOGO_PNG_HEIGHT) / INVOICE_LOGO_PNG_WIDTH;
  try {
    const logo = await doc.embedPng(Buffer.from(INVOICE_LOGO_PNG_BASE64, "base64"));
    page.drawImage(logo, { x: left, y: y - logoH, width: logoW, height: logoH });
  } catch {
    text(issuer.legalName, left, y - 14, 18, bold, NAVY);
  }
  textRight(isCredit ? "CREDIT NOTE" : "INVOICE", right, y - 2, 18, bold, NAVY);
  textRight(meta.invoiceNumber, right, y - 20, 10, bold);
  textRight(`Date: ${dt(meta.issueDate)}`, right, y - 33, 9, font, GREY);
  if (isCredit && meta.relatedInvoiceNumber) {
    textRight(`Cancels invoice ${meta.relatedInvoiceNumber}`, right, y - 45, 8, font, GREY);
  }

  // Issuer details (from admin company settings)
  y -= logoH + 14;
  text(issuer.legalName, left, y, 9, bold);
  textRight("NATO Edge 26 - Meeting Rooms", right, y, 9, font, GREY);
  const issuerLines = [
    [issuer.addressLine1, issuer.addressLine2].filter(Boolean).join(", "),
    [issuer.postalCode, issuer.city].filter(Boolean).join(" "),
    issuer.country,
    issuer.vatNumber ? `VAT ${issuer.vatNumber}` : "",
  ].filter(Boolean);
  for (const line of issuerLines) {
    y -= 10;
    text(line, left, y, 8, font, GREY);
  }

  // Bill to
  const b = meta.billTo;
  y -= 36;
  text("Bill to", left, y, 9, bold, GREY);
  y -= 14;
  // Company / legal name on top when known, otherwise the contact name.
  text(b?.legalName || meta.bookerName, left, y, 11, bold);
  y -= 13;
  const billLines = [
    // Show the contact name as a second line only when a legal name is on top.
    b?.legalName && meta.bookerName !== b.legalName ? meta.bookerName : "",
    [b?.addressLine1, b?.addressLine2].filter(Boolean).join(", "),
    [b?.postalCode, b?.city].filter(Boolean).join(" "),
    b?.country || "",
    b?.vatNumber ? `VAT ${b.vatNumber}` : "",
    meta.bookerEmail,
  ].filter(Boolean);
  for (const line of billLines) {
    text(line, left, y, 9, font, GREY);
    y -= 12;
  }

  // Table header
  y -= 30;
  const colVat = 330;
  const colHt = 430;
  const colTtc = right;
  page.drawRectangle({ x: left, y: y - 4, width: right - left, height: 20, color: rgb(0.96, 0.96, 0.98) });
  text("Description", left + 6, y + 2, 9, bold, GREY);
  textRight("VAT", colVat, y + 2, 9, bold, GREY);
  textRight("Excl. VAT", colHt, y + 2, 9, bold, GREY);
  textRight("Incl. VAT", colTtc, y + 2, 9, bold, GREY);
  y -= 22;

  // Lines
  for (const line of model.lines) {
    text(line.label, left + 6, y, 9);
    textRight(pct(line.vatRate), colVat, y, 9);
    textRight(amt(line.ht), colHt, y, 9);
    textRight(amt(line.totalTtc), colTtc, y, 9);
    y -= 18;
  }

  // Totals
  y -= 6;
  page.drawLine({
    start: { x: colHt - 60, y: y + 8 },
    end: { x: right, y: y + 8 },
    thickness: 0.5,
    color: GREY,
  });
  textRight("Total excl. VAT", colHt, y, 9, font, GREY);
  textRight(amt(model.totalHt), colTtc, y, 9);
  y -= 16;
  for (const v of model.vatBreakdown) {
    textRight(`VAT ${pct(v.vatRate)}`, colHt, y, 9, font, GREY);
    textRight(amt(v.vat), colTtc, y, 9);
    y -= 16;
  }
  textRight(isCredit ? "Total credited" : "Total incl. VAT", colHt, y, 11, bold, NAVY);
  textRight(amt(model.totalTtc), colTtc, y, 11, bold, NAVY);

  if (model.vatMention) {
    y -= 24;
    text(model.vatMention, left, y, 8, font, GREY);
  }

  // Booking recap — highlighted block under the amounts, restating what was
  // purchased (room + slot, Europe/Brussels).
  y -= 40;
  const boxH = 46;
  page.drawRectangle({
    x: left,
    y: y - boxH + 26,
    width: right - left,
    height: boxH,
    color: rgb(0.95, 0.96, 1),
    borderColor: NAVY,
    borderWidth: 0.6,
  });
  text("BOOKING", left + 12, y, 8, bold, NAVY);
  y -= 16;
  text(meta.roomName, left + 12, y, 11, bold, NAVY);
  y -= 13;
  text(`${dt(meta.startUtc)} to ${dt(meta.endUtc)} (Europe/Brussels)`, left + 12, y, 9, font, GREY);

  // Footer — three configurable columns (each multi-line), falling back to the
  // legacy single-line footer when no column is set.
  const bankLine = issuer.iban ? `IBAN ${issuer.iban}${issuer.bic ? ` · BIC ${issuer.bic}` : ""}` : "";
  const autoNote = isCredit
    ? "Credit note for a refunded Stripe payment, generated automatically."
    : "Paid via Stripe. This invoice was generated automatically.";

  const columns = [issuer.footerColumn1, issuer.footerColumn2, issuer.footerColumn3];
  if (columns.some((c) => c.trim().length > 0)) {
    const colX = [left, left + 175, left + 350];
    const colTop = 120;
    page.drawLine({
      start: { x: left, y: colTop + 12 },
      end: { x: right, y: colTop + 12 },
      thickness: 0.5,
      color: rgb(0.9, 0.9, 0.92),
    });
    columns.forEach((col, i) => {
      // Cap lines so a long column can't run into the bottom note.
      const lines = col.split("\n").slice(0, 7);
      let cy = colTop;
      for (const line of lines) {
        text(line, colX[i], cy, 7.5, font, GREY);
        cy -= 10;
      }
    });
  } else {
    text(
      issuer.legalFooter || `${issuer.legalName} - NATO Edge 26 - rooms.vo-eu.be`,
      left,
      58,
      8,
      font,
      GREY
    );
  }

  text(autoNote, left, 40, 7.5, font, GREY);
  if (bankLine) text(bankLine, left, 30, 7.5, font, GREY);

  return doc.save();
}
