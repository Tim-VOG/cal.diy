import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

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
}

// pdf-lib's standard fonts use WinAnsi; keep text to safe characters.
function ascii(s: string): string {
  return s.replace(/—|–/g, "-").replace(/×/g, "x").replace(/[^\x20-\x7E]/g, "");
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

  // Header — logo top-left (text fallback if the image can't embed), meta top-right
  const logoW = 130;
  const logoH = (logoW * INVOICE_LOGO_PNG_HEIGHT) / INVOICE_LOGO_PNG_WIDTH;
  try {
    const logo = await doc.embedPng(Buffer.from(INVOICE_LOGO_PNG_BASE64, "base64"));
    page.drawImage(logo, { x: left, y: y - logoH, width: logoW, height: logoH });
  } catch {
    text(issuer.legalName, left, y - 14, 18, bold, NAVY);
  }
  textRight("INVOICE", right, y - 2, 18, bold, NAVY);
  textRight(meta.invoiceNumber, right, y - 20, 10, bold);
  textRight(`Date: ${dt(meta.issueDate)}`, right, y - 33, 9, font, GREY);

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
  y -= 36;
  text("Bill to", left, y, 9, bold, GREY);
  y -= 14;
  text(meta.bookerName, left, y, 11, bold);
  y -= 13;
  text(meta.bookerEmail, left, y, 10, font, GREY);
  y -= 13;
  text(`${meta.roomName} - ${dt(meta.startUtc)} to ${dt(meta.endUtc)} (Europe/Brussels)`, left, y, 9, font, GREY);

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
    textRight(money(line.ht, model.currency), colHt, y, 9);
    textRight(money(line.totalTtc, model.currency), colTtc, y, 9);
    y -= 18;
  }

  // Totals
  y -= 6;
  page.drawLine({ start: { x: colHt - 60, y: y + 8 }, end: { x: right, y: y + 8 }, thickness: 0.5, color: GREY });
  textRight("Total excl. VAT", colHt, y, 9, font, GREY);
  textRight(money(model.totalHt, model.currency), colTtc, y, 9);
  y -= 16;
  for (const v of model.vatBreakdown) {
    textRight(`VAT ${pct(v.vatRate)}`, colHt, y, 9, font, GREY);
    textRight(money(v.vat, model.currency), colTtc, y, 9);
    y -= 16;
  }
  textRight("Total incl. VAT", colHt, y, 11, bold, NAVY);
  textRight(money(model.totalTtc, model.currency), colTtc, y, 11, bold, NAVY);

  // Footer
  const bankLine = issuer.iban ? `IBAN ${issuer.iban}${issuer.bic ? ` · BIC ${issuer.bic}` : ""}` : "";
  const footer = issuer.legalFooter || `${issuer.legalName} - NATO Edge 26 - rooms.vo-eu.be`;
  text("Paid via Stripe. This invoice was generated automatically.", left, 82, 8, font, GREY);
  if (bankLine) text(bankLine, left, 70, 8, font, GREY);
  text(footer, left, 58, 8, font, GREY);

  return doc.save();
}
