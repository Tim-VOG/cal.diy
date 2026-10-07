/**
 * The ledger view of what was sold: one row per document, not per room.
 *
 * The bookings export answers "which room, when, for whom". A bookkeeper asks
 * something else: which document, on what date, to which company, for how much
 * excl. VAT, VAT and incl. VAT, and against which payment. That question had no
 * export at all — the company name and the VAT number were on screen only.
 *
 * Amounts come from the VAT FROZEN on the order when the document was issued,
 * never from today's rate: the PDF in the accountant's folder cannot change, so
 * neither may the line that books it. A credit note is the same amounts with
 * the sign flipped, which is how it nets to zero in their ledger.
 */

import { buildInvoiceModel, ROOM_VAT_RATE_BP } from "./invoice";
import { EVENT_TIME_ZONE } from "./eventSchedule";
import { orderRef } from "./orderRef";

/** A credit note as the ledger sees it: its own rooms, its own amounts. */
export interface AccountingCreditNote {
  number: string;
  issuedAt: Date;
  amountHt: number;
  amountVat: number;
  amountTtc: number;
  currency: string;
  rooms: string[];
}

export interface AccountingOrder {
  orderNumber: number;
  invoiceNumber: string | null;
  invoiceIssuedAt: Date | null;
  creditNoteNumber: string | null;
  creditNoteIssuedAt: Date | null;
  bookerName: string;
  bookerEmail: string;
  bookerLegalName: string | null;
  bookerVatNumber: string | null;
  bookerCountry: string | null;
  bookerPoNumber: string | null;
  bookerInternalReference: string | null;
  currency: string;
  roomVatRate: number | null;
  vatZeroRated: boolean;
  vatMention: string | null;
  stripePaymentId: string | null;
  paidAt: Date | null;
  createdAt: Date;
  bookings: {
    durationMinutes: number;
    amountTotal: number;
    resource: { name: string };
    addOns: { quantity: number; lineTotal: number; vatRate: number; addOn: { name: string } }[];
  }[];
  /**
   * Every credit note raised against this invoice. A payment covering three
   * rooms can be credited one room at a time, so the amounts come from the note
   * itself rather than from the order total.
   */
  creditNotes: AccountingCreditNote[];
}

export const ACCOUNTING_HEADERS = [
  "Document",
  "Type",
  "Issued (Istanbul)",
  "Order",
  "Company",
  "Contact",
  "Email",
  "VAT number",
  "Country",
  "Rooms",
  "Room-hours",
  "Excl. VAT",
  "VAT rate",
  "VAT",
  "Incl. VAT",
  "Currency",
  "VAT mention",
  "Settled",
  "Stripe payment",
  "Paid (Istanbul)",
  "Cancels invoice",
  "PO number",
  "Internal reference",
];

export type AccountingCell = string | number | null;

/** "17/11/2026 14:05" in event time, so every date in the file reads the same way. */
export function fmtStamp(date: Date | null): string {
  if (!date) return "";
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: EVENT_TIME_ZONE,
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(date);
  const at = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return `${at("day")}/${at("month")}/${at("year")} ${at("hour")}:${at("minute")}`;
}

/**
 * One row per issued document, invoices before the credit notes that cancel
 * them. Amounts are whole units (12.10, not 1210) so the columns sum in Excel.
 */
export function accountingRows(orders: AccountingOrder[]): AccountingCell[][] {
  const rows: AccountingCell[][] = [];

  for (const order of orders) {
    const model = buildInvoiceModel(
      {
        currency: order.currency,
        roomVatRate: order.roomVatRate ?? ROOM_VAT_RATE_BP,
        rooms: order.bookings.map((b) => ({
          amountTotal: b.amountTotal,
          roomName: b.resource.name,
          durationMinutes: b.durationMinutes,
          addOns: b.addOns.map((a) => ({
            name: a.addOn.name,
            quantity: a.quantity,
            lineTotal: a.lineTotal,
            vatRate: a.vatRate,
          })),
        })),
      },
      { zeroRated: order.vatZeroRated, mention: order.vatMention }
    );

    const minutes = order.bookings.reduce((sum, b) => sum + b.durationMinutes, 0);
    const roomNames = order.bookings.map((b) => b.resource.name).join("; ");
    // Several rates only occur when catering is taxed apart from the room; the
    // usual case prints the one rate rather than a list of one.
    const rate = order.vatZeroRated
      ? 0
      : Array.from(new Set(model.vatBreakdown.map((v) => v.vatRate / 100))).join(" / ");

    const line = (
      documentNumber: string,
      type: "Invoice" | "Credit note",
      issuedAt: Date | null,
      sign: 1 | -1,
      /** A credit note covering only some rooms carries its own figures. */
      part?: { rooms: string; amountHt: number; amountVat: number; amountTtc: number }
    ): AccountingCell[] => [
      documentNumber,
      type,
      fmtStamp(issuedAt),
      orderRef(order.orderNumber),
      order.bookerLegalName ?? "",
      order.bookerName,
      order.bookerEmail,
      order.bookerVatNumber ?? "",
      order.bookerCountry ?? "",
      part ? part.rooms : roomNames,
      part ? "" : (sign * minutes) / 60,
      (sign * (part ? part.amountHt : model.totalHt)) / 100,
      rate,
      (sign * (part ? part.amountVat : model.totalVat)) / 100,
      (sign * (part ? part.amountTtc : model.totalTtc)) / 100,
      order.currency,
      model.vatMention ?? "",
      order.stripePaymentId ? "Stripe" : "Off-Stripe",
      order.stripePaymentId ?? "",
      fmtStamp(order.paidAt),
      type === "Credit note" ? (order.invoiceNumber ?? "") : "",
      order.bookerPoNumber ?? "",
      order.bookerInternalReference ?? "",
    ];

    if (order.invoiceNumber) {
      rows.push(line(order.invoiceNumber, "Invoice", order.invoiceIssuedAt ?? order.paidAt, 1));
    }
    for (const note of order.creditNotes) {
      // A credit note's own amounts, negated: the invoice and the notes against
      // it then sum to what the exhibitor actually kept.
      // A note migrated from before credit notes had rows of their own carries
      // no VAT split. It always covered the whole order, so the order's own
      // figures are the right ones.
      const whole = note.amountTtc === 0;
      rows.push(
        line(note.number, "Credit note", note.issuedAt, -1, {
          rooms: whole ? roomNames : note.rooms.join("; "),
          amountHt: whole ? model.totalHt : note.amountHt,
          amountVat: whole ? model.totalVat : note.amountVat,
          amountTtc: whole ? model.totalTtc : note.amountTtc,
        })
      );
    }
  }

  return rows;
}

/** What the file is called. Dated, so a folder of exports sorts by the day it was taken. */
export function accountingFileName(today: Date): string {
  return `ne26-accounting-${today.toISOString().slice(0, 10)}.xlsx`;
}
