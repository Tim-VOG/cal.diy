/**
 * Turn a Brussels calendar day into the UTC window it actually covers.
 *
 * The desk thinks in local days ("who is here today"), the database stores UTC.
 * Getting this wrong by an hour hides the first booking of the morning or shows
 * yesterday's last one, and the offset is not constant: Brussels is UTC+1 in
 * November and UTC+2 in summer, so the event's own dates and a summer rehearsal
 * do not behave the same way.
 */

const HOUR_MS = 60 * 60 * 1000;

/** The UTC offset in minutes that Europe/Brussels is at, at a given instant. */
function brusselsOffsetMinutes(at: Date): number {
  // Format the instant as Brussels wall-clock, read it back as if it were UTC:
  // the difference is the offset. Uses only Intl, so the DST rules come from the
  // platform's tz database rather than from a hardcoded table.
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Brussels",
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
 * Midnight-to-midnight in Brussels for `date` ("YYYY-MM-DD"), as UTC instants.
 * The end is exclusive.
 */
export function brusselsDayBounds(date: string): { fromUtc: Date; toUtc: Date } {
  const [year, month, day] = date.split("-").map(Number);
  const naiveMidnight = Date.UTC(year, month - 1, day, 0, 0, 0);

  // Two passes: the offset has to be measured at the instant we are solving for,
  // not at UTC midnight, or a day starting inside a DST change lands an hour out.
  const firstGuess = naiveMidnight - brusselsOffsetMinutes(new Date(naiveMidnight)) * 60000;
  const fromUtc = new Date(naiveMidnight - brusselsOffsetMinutes(new Date(firstGuess)) * 60000);

  const naiveNextMidnight = Date.UTC(year, month - 1, day + 1, 0, 0, 0);
  const nextGuess = naiveNextMidnight - brusselsOffsetMinutes(new Date(naiveNextMidnight)) * 60000;
  const toUtc = new Date(naiveNextMidnight - brusselsOffsetMinutes(new Date(nextGuess)) * 60000);

  return { fromUtc, toUtc };
}

/** Today's date in Brussels as "YYYY-MM-DD" — what the desk opens on. */
export function brusselsToday(now: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Brussels",
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
