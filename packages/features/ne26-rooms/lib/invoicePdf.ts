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
  /** False for a payment settled outside Stripe (admin "paid offline"). */
  paidViaStripe?: boolean;
  /** For a credit note: the invoice number it cancels. */
  relatedInvoiceNumber?: string;
  /** The buyer's own references. Printed only when they gave one. */
  poNumber?: string | null;
  internalReference?: string | null;
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

/**
 * pdf-lib's standard fonts are WinAnsi, so text must be reduced to characters they
 * can draw.
 *
 * The reduction TRANSLITERATES rather than deletes. It used to drop everything
 * outside printable ASCII, which silently mangled the buyer's legal name on a
 * Belgian VAT invoice sent to international NATO exhibitors: "Müller
 * Verteidigungstechnik" became "Mller Verteidigungstechnik" and "Société
 * Générale" became "Socit Gnrale".
 *
 * NFD splits an accented letter into a base plus a combining mark, so removing the
 * marks recovers ü→u and é→e. Scripts with no Latin base (Greek, Cyrillic, CJK)
 * still cannot be drawn by these fonts and become '?' — visible, rather than a
 * silent deletion. Embedding a Unicode TTF via @pdf-lib/fontkit is the real fix
 * the day such a name shows up.
 */
export function toPdfText(s: string): string {
  return s
    .replace(/[—–]/g, "-")
    // Separators the app itself emits between fields ("IBAN … · BIC …"). Without
    // this they fall through to the final catch-all and print as "?", which on an
    // invoice reads as a rendering fault.
    .replace(/[·•]/g, "-")
    .replace(/…/g, "...")
    .replace(/[\u00a0\u202f\u2009]/g, " ")
    .replace(/×/g, "x")
    .replace(/[’‘]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/ß/g, "ss")
    .replace(/Ø/g, "O")
    .replace(/ø/g, "o")
    .replace(/Æ/g, "AE")
    .replace(/æ/g, "ae")
    .replace(/Œ/g, "OE")
    .replace(/œ/g, "oe")
    .normalize("NFD")
    // Combining Diacritical Marks block. Written as an explicit range rather than
    // \p{Diacritic}: unicode property escapes need an ES6+ target, and some
    // packages here still compile to ES5.
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\x20-\x7E]/g, "?");
}

function ascii(s: string): string {
  return toPdfText(s);
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

/** Day only. An invoice is dated to the day; the time belongs on the booking. */
function d(date: Date): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Brussels",
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(date);
}

export async function renderInvoicePdf(
  model: InvoiceModel,
  meta: InvoiceMeta,
  issuer: InvoiceIssuer
): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  // `let`, because a booking with a long add-on list has to be able to spill
  // onto a second page. The draw helpers below close over the variable, so they
  // follow it when it is reassigned.
  let page = doc.addPage([595, 842]); // A4
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const boldItalic = await doc.embedFont(StandardFonts.HelveticaBoldOblique);
  const { width } = page.getSize();
  const left = 50;
  const right = width - 50;
  let y = 792;

  const text = (s: string, x: number, yy: number, size = 10, f = font, color = rgb(0, 0, 0)) =>
    page.drawText(ascii(s), { x, y: yy, size, font: f, color });
  const textRight = (s: string, xRight: number, yy: number, size = 10, f = font, color = rgb(0, 0, 0)) =>
    page.drawText(ascii(s), { x: xRight - f.widthOfTextAtSize(ascii(s), size), y: yy, size, font: f, color });

  // Everything below this belongs to the footer; content must not run into it.
  const FOOTER_TOP = 150;
  const ensureSpace = (needed: number) => {
    if (y - needed > FOOTER_TOP) return;
    page = doc.addPage([595, 842]);
    y = 792;
  };

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
  textRight(`Date: ${d(meta.issueDate)}`, right, y - 33, 9, font, GREY);
  if (isCredit && meta.relatedInvoiceNumber) {
    textRight(`Cancels invoice ${meta.relatedInvoiceNumber}`, right, y - 45, 8, font, GREY);
  }

  // Issuer details (from admin company settings). A credit note carries an extra
  // "Cancels invoice ..." line in the header, so the block starts lower — at the
  // shared offset the two collided and printed on top of each other.
  y -= logoH + (isCredit && meta.relatedInvoiceNumber ? 38 : 24);
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

  // The buyer's own references, when they gave any. An empty one prints nothing
  // rather than a dangling label — most exhibitors have neither.
  const references = [
    meta.poNumber?.trim() ? `PO ${meta.poNumber.trim()}` : "",
    meta.internalReference?.trim() ? `Ref. ${meta.internalReference.trim()}` : "",
  ].filter(Boolean);
  if (references.length) {
    y -= 4;
    text(references.join("    "), left, y, 9, bold);
    y -= 12;
  }

  // Table header
  y -= 26;
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
    ensureSpace(line.sublabel ? 30 : 18);
    text(line.label, left + 6, y, 9);
    textRight(pct(line.vatRate), colVat, y, 9);
    textRight(amt(line.ht), colHt, y, 9);
    textRight(amt(line.totalTtc), colTtc, y, 9);
    if (line.sublabel) {
      y -= 11;
      text(line.sublabel, left + 6, y, 8, font, GREY);
      y -= 19;
    } else {
      y -= 18;
    }
  }

  // Totals — kept whole: a total split across a page break is unreadable.
  ensureSpace(56 + model.vatBreakdown.length * 20);
  y -= 12;
  page.drawLine({
    start: { x: colHt - 60, y: y + 8 },
    end: { x: right, y: y + 8 },
    thickness: 0.5,
    color: GREY,
  });
  textRight("Total excl. VAT", colHt, y, 9, font, GREY);
  textRight(amt(model.totalHt), colTtc, y, 9);
  y -= 20;
  for (const v of model.vatBreakdown) {
    textRight(`VAT ${pct(v.vatRate)}`, colHt, y, 9, font, GREY);
    textRight(amt(v.vat), colTtc, y, 9);
    y -= 20;
  }
  y -= 4;
  textRight(isCredit ? "Total credited" : "Total incl. VAT", colHt, y, 12, bold, NAVY);
  textRight(amt(model.totalTtc), colTtc, y, 12, bold, NAVY);

  // Payment status, stated where the total is. It used to live only in 7.5pt
  // grey at the foot of the page, so an exhibitor forwarding this to their
  // finance team had nothing telling them it was already settled — and finance
  // chasing a paid invoice is a phone call nobody needs during the event.
  y -= 28;
  const statusLabel = isCredit
    ? "REFUNDED"
    : meta.paidViaStripe === false
      ? "PAYMENT DUE"
      : "PAID";
  const statusColor = isCredit ? rgb(0.55, 0.33, 0.05) : meta.paidViaStripe === false ? rgb(0.6, 0.2, 0.2) : rgb(0.06, 0.42, 0.24);
  const statusBg = isCredit ? rgb(1, 0.96, 0.88) : meta.paidViaStripe === false ? rgb(1, 0.94, 0.94) : rgb(0.91, 0.97, 0.93);
  const statusW = bold.widthOfTextAtSize(statusLabel, 10) + 22;
  page.drawRectangle({
    x: right - statusW,
    y: y - 5,
    width: statusW,
    height: 20,
    color: statusBg,
    borderColor: statusColor,
    borderWidth: 0.6,
  });
  textRight(statusLabel, right - 11, y, 10, bold, statusColor);

  // Bank details as a readable block rather than a 7.5pt line at the very foot
  // of the page — for a bank-transfer booking they are the actionable part of
  // the document, and nobody should have to squint at them.
  // Not on a credit note: an IBAN next to a refund reads as money still owed.
  if (issuer.iban && !isCredit) {
    y -= 34;
    ensureSpace(46);
    text("PAYMENT DETAILS", left, y, 8, bold, GREY);
    y -= 14;
    text(`Account holder  ${issuer.legalName}`, left, y, 9, font, GREY);
    y -= 12;
    text(`IBAN  ${issuer.iban}${issuer.bic ? `    BIC  ${issuer.bic}` : ""}`, left, y, 9);
    if (!isCredit && meta.paidViaStripe !== false) {
      y -= 12;
      text("Already settled by card - no transfer required.", left, y, 8, font, GREY);
    }
  }


  // VAT legal mention (reverse charge / exemption) — its own amber block, bold italic.
  if (model.vatMention) {
    y -= 16;
    const vTop = y;
    const vBottom = y - 26;
    page.drawRectangle({
      x: left,
      y: vBottom,
      width: right - left,
      height: vTop - vBottom,
      color: rgb(1, 0.96, 0.85),
      borderColor: rgb(0.85, 0.65, 0.13),
      borderWidth: 0.6,
    });
    text(model.vatMention, left + 14, vTop - 17, 9, boldItalic, rgb(0.5, 0.36, 0.03));
    y = vBottom;
  }

  // Footer — three configurable columns (each multi-line), falling back to the
  // legacy single-line footer when no column is set.
  const autoNote = isCredit
    ? "Credit note for a refunded Stripe payment, generated automatically."
    : meta.paidViaStripe === false
      ? "This invoice was generated automatically."
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

  return doc.save();
}
