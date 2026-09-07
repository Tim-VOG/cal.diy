/**
 * Notifications sent to the NE26 team (sales + admin) when money moves.
 *
 * Kept pure so the wording and — above all — the amounts can be asserted in unit
 * tests: the first version of these mails printed Stripe's raw minor units, so a
 * 871.20 EUR sale was announced to the sales team as "87120 EUR".
 *
 * Each builder returns both a text body and an HTML one. The text is what the
 * tests read and what a phone's notification preview shows; the HTML is the
 * same content in the layout the buyer-facing mails use, because the sales desk
 * reads these fastest and under the most pressure.
 */

import {
  type EmailRoomLine,
  card,
  confidentialNote,
  emailShell,
  escapeHtml,
  factRows,
  linkList,
  roomBlock,
  signOff,
  totalRow,
} from "./emailLayout";
import { EVENT_TIME_ZONE, EVENT_TIME_ZONE_LABEL } from "./eventSchedule";
import type { DeclineSummary } from "./stripeDecline";

/** Minor units -> "871.20 EUR". Never hand raw cents to a human. */
export function formatMoney(minorUnits: number, currency: string): string {
  return `${(minorUnits / 100).toFixed(2)} ${currency.toUpperCase()}`;
}

/** Event-local slot label, e.g. "Tue, 17 Nov 2026, 14:00-16:00 TRT". */
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
  return `${day}, ${time(start)}-${time(end)} ${EVENT_TIME_ZONE_LABEL}`;
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
  /**
   * Absolute link to this payment in the Stripe dashboard. The sales desk was
   * given an order uid and had to search Stripe by amount and time to find the
   * money behind it; this closes that gap in one click.
   */
  stripeUrl?: string | null;
  /** Absolute link to the admin dashboard — a relative path is unclickable in a mail client. */
  adminUrl: string;
}

/** What every one of these mails returns: the same content in two forms. */
export interface TeamNotification {
  subject: string;
  body: string;
  html: string;
}

const LABEL_WIDTH = 18;

function field(label: string, value: string): string {
  return `${`${label}:`.padEnd(LABEL_WIDTH)}${value}`;
}

/** The rooms, laid out the way the invoice mail lays them out. */
function roomLines(rooms: SaleNotificationRoom[], currency: string): EmailRoomLine[] {
  return rooms.map((room) => ({
    roomName: room.roomName,
    slotLabel: formatSlotRange(room.startUtc, room.endUtc),
    durationMinutes: room.durationMinutes,
    addOns: room.addOns.map((a) => ({
      name: a.name,
      quantity: a.quantity,
      lineLabel: formatMoney(a.lineTotal, currency),
    })),
  }));
}

/**
 * The "a room just sold" mail. Everything the sales desk needs to recognise the
 * order without opening the dashboard: which room, when, who, how much.
 */
export function saleNotification(input: SaleNotificationInput): TeamNotification {
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

  const vat = [input.bookerVatNumber, input.bookerCountry].filter(Boolean).join(" · ") || "-";
  const buyerLine = input.bookerEmail ? `${buyer} <${input.bookerEmail}>` : buyer;

  lines.push(field("Buyer", buyerLine));
  if (input.bookerCountry || input.bookerVatNumber) {
    lines.push(field("VAT", vat));
  }

  lines.push("", field("Total excl. VAT", formatMoney(input.amountHt, input.currency)));
  if (paid !== null) lines.push(field("Paid (incl. VAT)", formatMoney(paid, input.currency)));
  if (input.invoiceNumber) lines.push(field("Invoice", input.invoiceNumber));

  lines.push("", field("Order", input.orderUid), "", input.adminUrl);
  if (input.stripeUrl) lines.push(input.stripeUrl);

  const facts: { label: string; value: string; strong?: boolean }[] = [
    { label: "Buyer", value: buyerLine },
    ...(input.bookerCountry || input.bookerVatNumber ? [{ label: "VAT", value: vat }] : []),
    // The card above shows what Stripe captured; accounting works in the other
    // figure, and the text body has always carried both.
    { label: "Total excl. VAT", value: formatMoney(input.amountHt, input.currency) },
    ...(input.invoiceNumber ? [{ label: "Invoice", value: input.invoiceNumber }] : []),
    { label: "Order", value: input.orderUid },
  ];

  const html = emailShell(
    `<p style="margin:0 0 14px">${escapeHtml(buyer)} booked ${escapeHtml(what)}.</p>` +
      card(
        roomLines(rooms, input.currency).map(roomBlock).join("") +
          totalRow(
            paid === null ? "Total excl. VAT" : "Paid (incl. VAT)",
            formatMoney(paid ?? input.amountHt, input.currency)
          )
      ) +
      factRows(facts) +
      linkList([
        { label: "Open the order in the admin dashboard", href: input.adminUrl },
        ...(input.stripeUrl ? [{ label: "See the payment in Stripe", href: input.stripeUrl }] : []),
      ]) +
      signOff()
  );

  return { subject, body: lines.join("\n"), html };
}

/**
 * Why an order never got paid. Drives the wording, so it cannot be mistaken.
 *
 * The distinction that matters to whoever reads the mail is whether the rooms
 * are gone. A declined card is not the end of anything — the hold stands and
 * the buyer is still on the payment page — so telling the desk the rooms are
 * "back on sale" would send them chasing a sale that is still live.
 */
export type FailureReason = "payment_attempt_failed" | ReleaseReason;

/**
 * The subset that means the rooms are actually gone.
 *
 * Kept separate because it is what the BUYER may be told: "your room was not
 * booked" must never go out over a declined card, when their hold is still
 * standing and they are one retry away from paying.
 */
export type ReleaseReason = "payment_failed" | "session_expired";

export interface FailureNotificationInput {
  orderUid: string;
  reason: FailureReason;
  rooms: SaleNotificationRoom[];
  bookerName?: string | null;
  bookerEmail?: string | null;
  /** Order total excl. VAT — the sale that did not happen. */
  amountHt: number;
  currency: string;
  stripeUrl?: string | null;
  adminUrl: string;
  /** For an attempt that failed: how long the rooms are still held. */
  holdUntilLabel?: string | null;
  /** What the bank said, when Stripe told us. */
  declineMessage?: string | null;
  /**
   * The same decline, explained — the reason behind Stripe's deliberately vague
   * customer-facing message, and what to do about it.
   */
  decline?: DeclineSummary | null;
}

/**
 * The counterpart to saleNotification: a payment that failed, or a checkout
 * abandoned until it expired.
 *
 * Until now these were silent. A room came back on sale and nobody knew a buyer
 * had tried and failed — which during a three-day event is exactly the lead the
 * sales desk would want to call back the same morning.
 */
export function failureNotification(input: FailureNotificationInput): TeamNotification {
  const buyer = input.bookerName?.trim() || "An exhibitor";
  const rooms = input.rooms;
  const what =
    rooms.length === 1 ? `${rooms[0].roomName}, ${rooms[0].durationMinutes / 60}h` : `${rooms.length} rooms`;
  const headline =
    input.reason === "payment_attempt_failed"
      ? "Payment declined"
      : input.reason === "payment_failed"
        ? "Payment failed"
        : "Checkout expired";
  const subject = `${headline} — ${what} (${formatMoney(input.amountHt, input.currency)})`;

  const opening =
    input.reason === "payment_attempt_failed"
      ? `A card was declined. Nothing is lost yet: the rooms below are still held${
          input.holdUntilLabel ? ` until ${input.holdUntilLabel}` : ""
        } and the buyer can still pay. Worth a call if they do not.`
      : input.reason === "payment_failed"
        ? "A payment was attempted and declined. The rooms below are back on sale."
        : "A checkout was started and never completed. The rooms below are back on sale.";

  const lines: string[] = [opening, ""];
  const decline = input.decline ?? null;
  if (input.declineMessage) lines.push(field("Bank said", input.declineMessage));
  if (decline) {
    lines.push(field("Reason", decline.reason));
    lines.push(field("Next step", decline.nextStep));
    if (decline.card) lines.push(field("Card", decline.card));
    if (decline.codes) lines.push(field("Stripe code", decline.codes));
    if (!decline.tellBuyer) {
      lines.push("", "DO NOT REPEAT THE REASON ABOVE TO THE BUYER.");
    }
  }
  if (input.declineMessage || decline) lines.push("");
  for (const room of rooms) {
    lines.push(`${room.roomName} — ${room.durationMinutes / 60}h`);
    lines.push(`  ${formatSlotRange(room.startUtc, room.endUtc)}`);
    for (const addOn of room.addOns) {
      const name = addOn.quantity > 1 ? `${addOn.name} x ${addOn.quantity}` : addOn.name;
      lines.push(`  ${name} — ${formatMoney(addOn.lineTotal, input.currency)}`);
    }
    lines.push("");
  }

  const buyerLine = input.bookerEmail ? `${buyer} <${input.bookerEmail}>` : buyer;
  const stakeLabel = input.reason === "payment_attempt_failed" ? "At stake (excl. VAT)" : "Lost (excl. VAT)";

  lines.push(field("Buyer", buyerLine));
  lines.push(field(stakeLabel, formatMoney(input.amountHt, input.currency)));
  lines.push("", field("Order", input.orderUid), "", input.adminUrl);
  if (input.stripeUrl) lines.push(input.stripeUrl);

  const facts: { label: string; value: string; strong?: boolean }[] = [
    { label: "Buyer", value: buyerLine },
    ...(input.declineMessage ? [{ label: "Bank said", value: input.declineMessage }] : []),
    ...(decline
      ? [
          { label: "Reason", value: decline.reason, strong: true },
          { label: "Next step", value: decline.nextStep },
          ...(decline.card ? [{ label: "Card", value: decline.card }] : []),
          ...(decline.codes ? [{ label: "Stripe code", value: decline.codes }] : []),
        ]
      : []),
    { label: "Order", value: input.orderUid },
  ];

  const html = emailShell(
    `<p style="margin:0 0 14px">${escapeHtml(opening)}</p>` +
      card(
        roomLines(rooms, input.currency).map(roomBlock).join("") +
          totalRow(stakeLabel, formatMoney(input.amountHt, input.currency))
      ) +
      factRows(facts) +
      (decline && !decline.tellBuyer ? confidentialNote() : "") +
      linkList([
        { label: "Open the order in the admin dashboard", href: input.adminUrl },
        ...(input.stripeUrl ? [{ label: "See the attempt in Stripe", href: input.stripeUrl }] : []),
      ]) +
      signOff()
  );

  return { subject, body: lines.join("\n"), html };
}
