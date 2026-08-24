import {
  type DurationHours,
  EVENT_SCHEDULE,
  type EventDaySchedule,
  SELECTABLE_DURATIONS,
  SLOT_GRANULARITY_MS,
} from "./eventSchedule";

const MS_PER_HOUR = 60 * 60 * 1000;

export interface AvailableStart {
  /** Atomic slot start, in UTC (ISO 8601). */
  startUtc: string;
  /** Durations (in hours) bookable from this start — a subset of [1, 2, 3]. */
  availableDurations: DurationHours[];
}

export interface EventDayAvailability {
  date: string;
  starts: AvailableStart[];
}

/**
 * Compute, per event day, which (start, duration) combinations are still
 * bookable for one room given the atomic slots already taken and the turnover
 * buffer required after a booking.
 *
 * A duration is offered from a start only if (a) every slot it spans is within
 * the day's opening window and not taken, and (b) the buffer slots immediately
 * after it are not taken — so a new booking always keeps `bufferMinutes` clear
 * of the next one. Existing bookings reserve their own trailing buffer, so this
 * is symmetric and the DB unique index remains the hard guarantee.
 *
 * @param takenSlotStartsUtc slots occupied by CONFIRMED or actively-held PENDING
 *   bookings (incl. their reserved buffer); the caller resolves "active hold".
 * A start that has already begun is never offered. The booking URL stays live
 * during the event and the hostess tablet stays open on it, so without this a
 * buyer can select — and pay for — a slot that started hours ago. `now` is
 * always supplied by the caller rather than defaulted, so this stays a pure
 * function and its tests stay deterministic once the event date has passed.
 *
 * @param bufferMinutes turnover buffer required after a booking (admin setting).
 * @param now current instant; a start at or before it is not bookable.
 * @param schedule open slot marks per day; defaults to the built-in NE26 hours.
 */
export function computeAvailability(
  takenSlotStartsUtc: Date[],
  bufferMinutes: number,
  now: Date = new Date(),
  schedule: readonly EventDaySchedule[] = EVENT_SCHEDULE
): EventDayAvailability[] {
  const taken = new Set(takenSlotStartsUtc.map((d) => d.getTime()));
  const bufferMs = Math.max(0, bufferMinutes) * 60 * 1000;
  const bufferCount = Math.max(0, Math.ceil(bufferMs / SLOT_GRANULARITY_MS));
  const nowMs = now.getTime();

  return schedule.map((day) => {
    const openSlots = new Set(day.openSlotStartsUtc.map((d) => d.getTime()));
    const marks = day.openSlotStartsUtc.map((d) => d.getTime());
    const lastMark = marks[marks.length - 1];

    /** Whether a booking of `duration` starting here is genuinely sellable. */
    const fits = (startMs: number, duration: DurationHours): boolean => {
      if (startMs < nowMs) return false;
      const slotCount = (duration * MS_PER_HOUR) / SLOT_GRANULARITY_MS;
      for (let i = 0; i < slotCount; i++) {
        const slotMs = startMs + i * SLOT_GRANULARITY_MS;
        if (!openSlots.has(slotMs) || taken.has(slotMs)) return false;
      }
      // The cleaning gap this booking would reserve must be free too. Existing
      // bookings reserve their own, so this is symmetric: a new booking can
      // never end flush against one already there.
      const endMs = startMs + duration * MS_PER_HOUR;
      for (let i = 0; i < bufferCount; i++) {
        if (taken.has(endMs + i * SLOT_GRANULARITY_MS)) return false;
      }
      return true;
    };

    // Offered starts CHAIN: each one is the previous plus its duration plus the
    // cleaning gap, so the times on offer are a run of bookings that can all
    // actually happen one after another.
    //
    // Listing every hour instead would advertise slots that undo each other —
    // with a 15-minute gap, taking the 10:15 hour makes 11:00 impossible, yet
    // both were shown. Walking the day per duration means the buyer only sees
    // times that still work whichever of them they pick first, and the room is
    // packed rather than left with unsellable 45-minute holes.
    const durationsByStart = new Map<number, DurationHours[]>();
    for (const duration of SELECTABLE_DURATIONS) {
      let cursor = marks[0];
      while (cursor !== undefined && lastMark !== undefined && cursor <= lastMark) {
        if (fits(cursor, duration)) {
          const list = durationsByStart.get(cursor) ?? [];
          list.push(duration);
          durationsByStart.set(cursor, list);
          cursor += duration * MS_PER_HOUR + bufferMs;
        } else {
          // Occupied, in the past, or too close to the end of the day: step to
          // the next mark so the chain re-anchors after whatever blocked it.
          cursor += SLOT_GRANULARITY_MS;
        }
      }
    }

    const starts: AvailableStart[] = Array.from(durationsByStart.entries())
      .sort(([a], [b]) => a - b)
      .map(([startMs, availableDurations]) => ({
        startUtc: new Date(startMs).toISOString(),
        availableDurations: [...availableDurations].sort((a, b) => a - b),
      }));

    return { date: day.date, starts };
  });
}
