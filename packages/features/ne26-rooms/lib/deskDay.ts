/**
 * Turn a local calendar day into the UTC window it actually covers.
 *
 * The desk thinks in local days ("who is here today"), the database stores UTC.
 * Getting this wrong by an hour hides the first booking of the morning or shows
 * yesterday's last one.
 *
 * The offset is read from the platform's tz database rather than hardcoded.
 * Europe/Istanbul is a flat UTC+3 today, so a constant would work — but it was
 * not always, the app has already moved timezone once, and a wrong assumption
 * here is invisible until a booking lands on the wrong day.
 */

import { EVENT_TIME_ZONE } from "./eventSchedule";

const HOUR_MS = 60 * 60 * 1000;

/** The UTC offset in minutes the event's timezone is at, at a given instant. */
function eventOffsetMinutes(at: Date): number {
  // Format the instant as Istanbul wall-clock, read it back as if it were UTC:
  // the difference is the offset. Uses only Intl, so the DST rules come from the
  // platform's tz database rather than from a hardcoded table.
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: EVENT_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(at);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  const asUtc = Date.UTC(
    get("year"),
    get("month") - 1,
    get("day"),
    get("hour") % 24,
    get("minute"),
    get("second")
  );
  return (asUtc - at.getTime()) / 60000;
}

/**
 * Midnight-to-midnight in Istanbul for `date` ("YYYY-MM-DD"), as UTC instants.
 * The end is exclusive.
 */
export function eventDayBounds(date: string): { fromUtc: Date; toUtc: Date } {
  const [year, month, day] = date.split("-").map(Number);
  const naiveMidnight = Date.UTC(year, month - 1, day, 0, 0, 0);

  // Two passes: the offset is measured at the instant being solved for, not at
  // UTC midnight, so a day starting inside a DST change cannot land an hour out.
  const firstGuess = naiveMidnight - eventOffsetMinutes(new Date(naiveMidnight)) * 60000;
  const fromUtc = new Date(naiveMidnight - eventOffsetMinutes(new Date(firstGuess)) * 60000);

  const naiveNextMidnight = Date.UTC(year, month - 1, day + 1, 0, 0, 0);
  const nextGuess = naiveNextMidnight - eventOffsetMinutes(new Date(naiveNextMidnight)) * 60000;
  const toUtc = new Date(naiveNextMidnight - eventOffsetMinutes(new Date(nextGuess)) * 60000);

  return { fromUtc, toUtc };
}

/** Today's date in Istanbul as "YYYY-MM-DD" — what the desk opens on. */
export function eventToday(now: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: EVENT_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
  return parts;
}

/** Shift a "YYYY-MM-DD" by whole days, staying on calendar days. */
export function shiftDay(date: string, days: number): string {
  const [year, month, day] = date.split("-").map(Number);
  const shifted = new Date(Date.UTC(year, month - 1, day) + days * 24 * HOUR_MS);
  return shifted.toISOString().slice(0, 10);
}
