/**
 * NE26 event schedule (NATO Edge 26).
 *
 * Opening times are defined in Europe/Brussels. November is always CET
 * (UTC+1, DST ends late October), so every sellable hour maps to a whole UTC
 * hour. We materialise the schedule directly in UTC to keep all slot math
 * timezone-free; the display layer renders these back in Europe/Brussels.
 */

export type DurationHours = 1 | 2 | 3;

export const SELECTABLE_DURATIONS: readonly DurationHours[] = [1, 2, 3];

const BRUSSELS_UTC_OFFSET_HOURS = 1; // CET, valid for the event dates in November

interface EventDayDefinition {
  /** Calendar date in Europe/Brussels (also used for display grouping). */
  date: `${number}-${number}-${number}`;
  /** First bookable hour in Europe/Brussels (inclusive). */
  openHourBrussels: number;
  /** Closing hour in Europe/Brussels (exclusive): the last 1h slot starts at closeHour - 1. */
  closeHourBrussels: number;
}

const EVENT_DAYS: readonly EventDayDefinition[] = [
  { date: "2026-11-17", openHourBrussels: 14, closeHourBrussels: 17 },
  { date: "2026-11-18", openHourBrussels: 9, closeHourBrussels: 17 },
  { date: "2026-11-19", openHourBrussels: 9, closeHourBrussels: 11 },
];

function brusselsHourToUtcDate(date: string, brusselsHour: number): Date {
  const utcHour = brusselsHour - BRUSSELS_UTC_OFFSET_HOURS;
  return new Date(`${date}T${String(utcHour).padStart(2, "0")}:00:00.000Z`);
}

export interface EventDaySchedule {
  date: string;
  /** Start of each atomic 1h slot that can begin a booking, in UTC, in order. */
  sellableHourStartsUtc: Date[];
}

/**
 * The atomic 1h slot starts that are open for booking on each event day.
 * A 2h/3h booking must fit entirely within a single day's window.
 */
export const EVENT_SCHEDULE: readonly EventDaySchedule[] = EVENT_DAYS.map((day) => {
  const sellableHourStartsUtc: Date[] = [];
  for (let hour = day.openHourBrussels; hour < day.closeHourBrussels; hour++) {
    sellableHourStartsUtc.push(brusselsHourToUtcDate(day.date, hour));
  }
  return { date: day.date, sellableHourStartsUtc };
});
