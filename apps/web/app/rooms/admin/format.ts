import { EVENT_TIME_ZONE } from "@calcom/features/ne26-rooms/lib/eventSchedule";

/**
 * How the admin writes times, money and statuses — in one place so the plan,
 * the list, the panel and the order page cannot disagree about any of them.
 * The refunded status was the proof: only the list knew it existed.
 */

const TZ = EVENT_TIME_ZONE;

/** "Wed 18 Nov" */
export function fmtDay(iso: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: TZ,
    weekday: "short",
    day: "numeric",
    month: "short",
  }).format(new Date(iso));
}
/** "Wednesday 18 November" */
export function fmtDayLong(iso: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: TZ,
    weekday: "long",
    day: "numeric",
    month: "long",
  }).format(new Date(iso));
}
/** "1 Sep, 20:15" — a moment, as opposed to a slot. */
export function fmtMoment(iso: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: TZ,
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(iso));
}
/** "14:15" */
export function fmtTime(iso: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: TZ,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(iso));
}
export function fmtMoney(cents: number, currency = "EUR"): string {
  return new Intl.NumberFormat("en-GB", { style: "currency", currency }).format(cents / 100);
}
/** Event-local YYYY-MM-DD, the key days are grouped and filtered by. */
export function dayKey(iso: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(iso));
}
/** "1:05" for a hold countdown. */
export function fmtCountdown(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}
/** "3 h", "1.5 h", "0 h" */
export function fmtHours(hours: number): string {
  return `${Number.isInteger(hours) ? hours : hours.toFixed(1)} h`;
}

/**
 * What the desk reads, which is not always what the database stores: a refund
 * and a cancellation are both CANCELLED, and only the credit note tells them
 * apart.
 */
export function displayStatus(row: { status: string; creditNoteNumber: string | null }): string {
  return row.status === "CANCELLED" && row.creditNoteNumber ? "REFUNDED" : row.status;
}
