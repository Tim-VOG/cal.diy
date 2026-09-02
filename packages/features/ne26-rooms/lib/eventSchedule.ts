/**
 * NE26 event schedule (NATO Edge 26).
 *
 * The event runs in Turkey, so opening times are defined in Europe/Istanbul —
 * which sits at UTC+3 all year and has observed no DST since 2016, making the
 * offset a constant rather than a seasonal one. The schedule is materialised
 * directly in UTC to keep all slot maths timezone-free; the display layer
 * renders it back in local time.
 *
 * This is the ONE place the event's timezone is declared. Everything else
 * imports EVENT_TIME_ZONE rather than naming a zone of its own.
 */

export type DurationHours = 1 | 2 | 3;

export const SELECTABLE_DURATIONS: readonly DurationHours[] = [1, 2, 3];

/**
 * Atomic slot granularity in minutes. Bookings start on, and are split into,
 * marks of this size, and the editable buffer is expressed in multiples of it.
 * Change to 30 for half-hour slots (the buffer must stay a multiple of this).
 */
export const SLOT_GRANULARITY_MINUTES = 15;

/** The event's local timezone. Displayed times and opening hours are in it. */
export const EVENT_TIME_ZONE = "Europe/Istanbul";

/**
 * How the zone is written for people, as opposed to for Intl.
 *
 * The event's own communications say TRT, and an exhibitor in Izmir reading
 * "Europe/Istanbul" on their confirmation is being shown a database key.
 */
export const EVENT_TIME_ZONE_LABEL = "TRT";

/** Europe/Istanbul is a fixed UTC+3 — no DST to straddle. */
const EVENT_UTC_OFFSET_HOURS = 3;
const MS_PER_MINUTE = 60 * 1000;

// A `type` (not `interface`) so the day list stays assignable to Prisma's
// InputJsonValue when persisted to the Ne26RoomSettings.eventDays JSON column.
export type EventDayDefinition = {
  /** Calendar date in the event's timezone (also used for display grouping). */
  date: string;
  /** First bookable hour, local (inclusive). */
  openHour: number;
  /** Closing hour, local (exclusive): no slot may start at or after it. */
  closeHour: number;
};

/** Built-in NE26 opening hours, used when no admin override is stored. */
export const DEFAULT_EVENT_DAYS: readonly EventDayDefinition[] = [
  { date: "2026-11-17", openHour: 14, closeHour: 17 },
  { date: "2026-11-18", openHour: 9, closeHour: 17 },
  { date: "2026-11-19", openHour: 9, closeHour: 11 },
];

/**
 * Coerce an untrusted value (e.g. the Ne26RoomSettings.eventDays JSON column)
 * into a clean day list. Falls back to {@link DEFAULT_EVENT_DAYS} when the
 * value is missing or malformed, so callers never have to null-check.
 */
export function normalizeEventDays(value: unknown): EventDayDefinition[] {
  if (!Array.isArray(value)) return [...DEFAULT_EVENT_DAYS];

  const days: EventDayDefinition[] = [];
  for (const raw of value) {
    if (typeof raw !== "object" || raw === null) continue;
    const row = raw as Record<string, unknown>;
    if (typeof row.date !== "string") continue;

    // The keys used to be openHourBrussels/closeHourBrussels. Rows written
    // before the event moved to Turkey still carry them, and a row this
    // rejects falls back to the built-in hours — silently reopening the rooms
    // at times nobody chose. So both spellings are read; only the new one is
    // written.
    const open = row.openHour ?? row.openHourBrussels;
    const close = row.closeHour ?? row.closeHourBrussels;
    if (!Number.isInteger(open) || !Number.isInteger(close)) continue;

    const openHour = open as number;
    const closeHour = close as number;
    if (openHour < 0 || closeHour > 24 || openHour >= closeHour) continue;

    days.push({ date: row.date, openHour, closeHour });
  }
  return days.length > 0 ? days : [...DEFAULT_EVENT_DAYS];
}

function localMinuteToUtcDate(date: string, localTotalMinutes: number): Date {
  const utcTotalMinutes = localTotalMinutes - EVENT_UTC_OFFSET_HOURS * 60;
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
    const openMinute = day.openHour * 60;
    const closeMinute = day.closeHour * 60;
    for (let minute = openMinute; minute < closeMinute; minute += SLOT_GRANULARITY_MINUTES) {
      openSlotStartsUtc.push(localMinuteToUtcDate(day.date, minute));
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
