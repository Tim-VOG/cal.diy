/**
 * Plain-text notifications sent to the NE26 team (sales + admin) when money
 * moves. Kept pure so the wording and — above all — the amounts can be asserted
 * in unit tests: the first version of these mails printed Stripe's raw minor
 * units, so a 871.20 EUR sale was announced to the sales team as "87120 EUR".
 */

import { EVENT_TIME_ZONE } from "./eventSchedule";

/** Minor units -> "871.20 EUR". Never hand raw cents to a human. */
export function formatMoney(minorUnits: number, currency: string): string {
  return `${(minorUnits / 100).toFixed(2)} ${currency.toUpperCase()}`;
}

/** Event-local slot label, e.g. "Tue, 17 Nov 2026, 14:00-16:00 (Europe/Istanbul)". */
export function formatSlotRange(start: Date, end: Date): string {
  const day = new Intl.DateTimeFormat("en-GB", {
    timeZone: EVENT_TIME_ZONE,
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(start);
  const time = (d: Date) =>
    new Intl.DateTimeFormat("en-GB", {
      timeZone: EVENT_TIME_ZONE,
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).format(d);
  return `${day}, ${time(start)}-${time(end)} (${EVENT_TIME_ZONE})`;
}

export interface SaleNotificationRoom {
  roomName: string;
  startUtc: Date;
  endUtc: Date;
  durationMinutes: number;
  addOns: { name: string; quantity: number; lineTotal: number }[];
}

export interface SaleNotificationInput {
  orderUid: string;
  /** One payment can cover several rooms; the mail lists them all. */
  rooms: SaleNotificationRoom[];
  bookerName?: string | null;
  bookerEmail?: string | null;
  bookerCountry?: string | null;
  bookerVatNumber?: string | null;
  /** Order total excl. VAT. */
  amountHt: number;
  /** What Stripe actually captured (incl. VAT). Null if the event carried none. */
  amountPaid?: number | null;
  currency: string;
  invoiceNumber?: string | null;
  /** Absolute link to the admin dashboard — a relative path is unclickable in a mail client. */
  adminUrl: string;
}

const LABEL_WIDTH = 18;

function field(label: string, value: string): string {
  return `${`${label}:`.padEnd(LABEL_WIDTH)}${value}`;
}

/**
 * The "a room just sold" mail. Everything the sales desk needs to recognise the
 * order without opening the dashboard: which room, when, who, how much.
 */
export function saleNotification(input: SaleNotificationInput): { subject: string; body: string } {
  const paid = input.amountPaid ?? null;
  const buyer = input.bookerName?.trim() || "An exhibitor";
  const rooms = input.rooms;

  // Naming every room in the subject would run past what any client shows, so
  // one room is named and the rest counted.
  const what =
    rooms.length === 1 ? `${rooms[0].roomName}, ${rooms[0].durationMinutes / 60}h` : `${rooms.length} rooms`;
  const subject = `Room sold — ${what}${paid === null ? "" : ` (${formatMoney(paid, input.currency)})`}`;

  const lines: string[] = [];
  for (const room of rooms) {
    lines.push(`${room.roomName} — ${room.durationMinutes / 60}h`);
    lines.push(`  ${formatSlotRange(room.startUtc, room.endUtc)}`);
    for (const addOn of room.addOns) {
      const name = addOn.quantity > 1 ? `${addOn.name} x ${addOn.quantity}` : addOn.name;
      lines.push(`  ${name} — ${formatMoney(addOn.lineTotal, input.currency)}`);
    }
    lines.push("");
  }

  lines.push(field("Buyer", input.bookerEmail ? `${buyer} <${input.bookerEmail}>` : buyer));
  if (input.bookerCountry || input.bookerVatNumber) {
    lines.push(field("VAT", [input.bookerVatNumber, input.bookerCountry].filter(Boolean).join(" · ") || "-"));
  }

  lines.push("", field("Total excl. VAT", formatMoney(input.amountHt, input.currency)));
  if (paid !== null) lines.push(field("Paid (incl. VAT)", formatMoney(paid, input.currency)));
  if (input.invoiceNumber) lines.push(field("Invoice", input.invoiceNumber));

  lines.push("", field("Order", input.orderUid), "", input.adminUrl);

  return { subject, body: lines.join("\n") };
}
