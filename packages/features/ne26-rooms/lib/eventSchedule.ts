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

// A `type` (not `interface`) so the day list stays assignable to Prisma's
// InputJsonValue when persisted to the Ne26RoomSettings.eventDays JSON column.
export type EventDayDefinition = {
  /** Calendar date in Europe/Brussels (also used for display grouping). */
  date: string;
  /** First bookable hour in Europe/Brussels (inclusive). */
  openHourBrussels: number;
  /** Closing hour in Europe/Brussels (exclusive): no slot may start at/after it. */
  closeHourBrussels: number;
};

/** Built-in NE26 opening hours, used when no admin override is stored. */
export const DEFAULT_EVENT_DAYS: readonly EventDayDefinition[] = [
  { date: "2026-11-17", openHourBrussels: 14, closeHourBrussels: 17 },
  { date: "2026-11-18", openHourBrussels: 9, closeHourBrussels: 17 },
  { date: "2026-11-19", openHourBrussels: 9, closeHourBrussels: 11 },
];

/**
 * Coerce an untrusted value (e.g. the Ne26RoomSettings.eventDays JSON column)
 * into a clean day list. Falls back to {@link DEFAULT_EVENT_DAYS} when the
 * value is missing or malformed, so callers never have to null-check.
 */
export function normalizeEventDays(value: unknown): EventDayDefinition[] {
  if (!Array.isArray(value)) return [...DEFAULT_EVENT_DAYS];
  const days = value.filter(
    (d): d is EventDayDefinition =>
      typeof d === "object" &&
      d !== null &&
      typeof (d as EventDayDefinition).date === "string" &&
      Number.isInteger((d as EventDayDefinition).openHourBrussels) &&
      Number.isInteger((d as EventDayDefinition).closeHourBrussels) &&
      (d as EventDayDefinition).openHourBrussels >= 0 &&
      (d as EventDayDefinition).closeHourBrussels <= 24 &&
      (d as EventDayDefinition).openHourBrussels < (d as EventDayDefinition).closeHourBrussels
  );
  return days.length > 0 ? days : [...DEFAULT_EVENT_DAYS];
}

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
 * Materialise the open atomic slot marks (at SLOT_GRANULARITY_MINUTES) for each
 * configured day. A booking of D hours fits a day only if all its slot marks
 * are present (i.e. it ends by the close hour); buffer slots may extend beyond.
 * Pure: pass either the admin's configured days or {@link DEFAULT_EVENT_DAYS}.
 */
export function buildEventSchedule(days: readonly EventDayDefinition[]): EventDaySchedule[] {
  return days.map((day) => {
    const openSlotStartsUtc: Date[] = [];
    const openMinute = day.openHourBrussels * 60;
    const closeMinute = day.closeHourBrussels * 60;
    for (let minute = openMinute; minute < closeMinute; minute += SLOT_GRANULARITY_MINUTES) {
      openSlotStartsUtc.push(brusselsMinuteToUtcDate(day.date, minute));
    }
    return { date: day.date, openSlotStartsUtc };
  });
}

/** Every open slot mark of a schedule, as epoch-ms (window membership test). */
export function buildOpenSlotMs(schedule: readonly EventDaySchedule[]): Set<number> {
  return new Set(schedule.flatMap((day) => day.openSlotStartsUtc.map((d) => d.getTime())));
}

/** Default schedule (built-in hours); callers with admin overrides build their own. */
export const EVENT_SCHEDULE: readonly EventDaySchedule[] = buildEventSchedule(DEFAULT_EVENT_DAYS);

/** Default open-slot set. Services that read settings build this per request. */
export const OPEN_SLOT_MS: ReadonlySet<number> = buildOpenSlotMs(EVENT_SCHEDULE);

export const SLOT_GRANULARITY_MS = SLOT_GRANULARITY_MINUTES * MS_PER_MINUTE;
