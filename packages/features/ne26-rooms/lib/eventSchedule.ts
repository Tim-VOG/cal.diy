/**
 * NE26 event schedule (NATO Edge 26).
 *
 * Opening times are defined in Europe/Brussels. November is always CET
 * (UTC+1, DST ends late October), so every slot mark maps to a whole UTC
 * minute. We materialise the schedule directly in UTC to keep all slot math
 * timezone-free; the display layer renders these back in Europe/Brussels.
 */

export type DurationHours = 1 | 2 | 3;

export const SELECTABLE_DURATIONS: readonly DurationHours[] = [1, 2, 3];

/**
 * Atomic slot granularity in minutes. Bookings start on, and are split into,
 * marks of this size, and the editable buffer is expressed in multiples of it.
 * Change to 30 for half-hour slots (the buffer must stay a multiple of this).
 */
export const SLOT_GRANULARITY_MINUTES = 15;

const BRUSSELS_UTC_OFFSET_HOURS = 1; // CET, valid for the event dates in November
const MS_PER_MINUTE = 60 * 1000;

interface EventDayDefinition {
  /** Calendar date in Europe/Brussels (also used for display grouping). */
  date: `${number}-${number}-${number}`;
  /** First bookable hour in Europe/Brussels (inclusive). */
  openHourBrussels: number;
  /** Closing hour in Europe/Brussels (exclusive): no slot may start at/after it. */
  closeHourBrussels: number;
}

const EVENT_DAYS: readonly EventDayDefinition[] = [
  { date: "2026-11-17", openHourBrussels: 14, closeHourBrussels: 17 },
  { date: "2026-11-18", openHourBrussels: 9, closeHourBrussels: 17 },
  { date: "2026-11-19", openHourBrussels: 9, closeHourBrussels: 11 },
];

function brusselsMinuteToUtcDate(date: string, brusselsTotalMinutes: number): Date {
  const utcTotalMinutes = brusselsTotalMinutes - BRUSSELS_UTC_OFFSET_HOURS * 60;
  const hh = String(Math.floor(utcTotalMinutes / 60)).padStart(2, "0");
  const mm = String(utcTotalMinutes % 60).padStart(2, "0");
  return new Date(`${date}T${hh}:${mm}:00.000Z`);
}

export interface EventDaySchedule {
  date: string;
  /** Start of every atomic slot inside the open window, in UTC, in order. */
  openSlotStartsUtc: Date[];
}

/**
 * Every atomic slot mark open on each event day, at SLOT_GRANULARITY_MINUTES.
 * A booking of D hours fits a day only if all its slot marks are in this set
 * (i.e. it ends by the close hour). Buffer slots may extend beyond it.
 */
export const EVENT_SCHEDULE: readonly EventDaySchedule[] = EVENT_DAYS.map((day) => {
  const openSlotStartsUtc: Date[] = [];
  const openMinute = day.openHourBrussels * 60;
  const closeMinute = day.closeHourBrussels * 60;
  for (let minute = openMinute; minute < closeMinute; minute += SLOT_GRANULARITY_MINUTES) {
    openSlotStartsUtc.push(brusselsMinuteToUtcDate(day.date, minute));
  }
  return { date: day.date, openSlotStartsUtc };
});

/** Every open slot mark across the whole event, as epoch-ms (window membership test). */
export const OPEN_SLOT_MS: ReadonlySet<number> = new Set(
  EVENT_SCHEDULE.flatMap((day) => day.openSlotStartsUtc.map((d) => d.getTime()))
);

export const SLOT_GRANULARITY_MS = SLOT_GRANULARITY_MINUTES * MS_PER_MINUTE;
