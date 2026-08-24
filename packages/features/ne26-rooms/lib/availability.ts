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
  const bufferCount = Math.max(0, Math.ceil((bufferMinutes * 60 * 1000) / SLOT_GRANULARITY_MS));
  const nowMs = now.getTime();

  return schedule.map((day) => {
    const openSlots = new Set(day.openSlotStartsUtc.map((d) => d.getTime()));
    const dayOpenMs = day.openSlotStartsUtc[0]?.getTime() ?? 0;

    // Starts are offered on the hour, PLUS the first free slot after anything
    // already booked.
    //
    // On the hour alone loses real inventory: with a 15-minute cleaning gap, a
    // 09:00-10:00 booking occupies through 10:15, so the next hourly start that
    // fits is 11:00 and the 10:15-11:15 hour is unsellable — even though the
    // room is empty. Offering the moment the room frees up recovers it, and the
    // grid stays short because these only appear where something ended.
    const offered = day.openSlotStartsUtc.filter((d) => {
      const ms = d.getTime();
      if ((ms - dayOpenMs) % MS_PER_HOUR === 0) return true;
      // Resumes right after an occupied run — never mid-run, since a taken slot
      // is filtered out by the duration check below anyway.
      return taken.has(ms - SLOT_GRANULARITY_MS) && !taken.has(ms);
    });

    const starts: AvailableStart[] = offered.map((start) => {
      const startMs = start.getTime();
      // Past starts are closed outright, whatever the slot state.
      if (startMs < nowMs) return { startUtc: start.toISOString(), availableDurations: [] };
      const availableDurations = SELECTABLE_DURATIONS.filter((duration) => {
        const slotCount = (duration * MS_PER_HOUR) / SLOT_GRANULARITY_MS;
        // Every slot of the booking must be open (within the window) and free.
        for (let i = 0; i < slotCount; i++) {
          const slotMs = startMs + i * SLOT_GRANULARITY_MS;
          if (!openSlots.has(slotMs) || taken.has(slotMs)) return false;
        }
        // The trailing buffer slots must be free (they may extend past close).
        const endMs = startMs + duration * MS_PER_HOUR;
        for (let i = 0; i < bufferCount; i++) {
          if (taken.has(endMs + i * SLOT_GRANULARITY_MS)) return false;
        }
        return true;
      });
      return { startUtc: start.toISOString(), availableDurations: [...availableDurations] };
    });

    return { date: day.date, starts };
  });
}
