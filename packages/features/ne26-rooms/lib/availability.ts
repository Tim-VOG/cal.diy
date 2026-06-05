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
 * @param bufferMinutes turnover buffer required after a booking (admin setting).
 * @param schedule open slot marks per day; defaults to the built-in NE26 hours.
 */
export function computeAvailability(
  takenSlotStartsUtc: Date[],
  bufferMinutes: number,
  startStepMinutes = 60,
  schedule: readonly EventDaySchedule[] = EVENT_SCHEDULE
): EventDayAvailability[] {
  const taken = new Set(takenSlotStartsUtc.map((d) => d.getTime()));
  const bufferCount = Math.max(0, Math.ceil((bufferMinutes * 60 * 1000) / SLOT_GRANULARITY_MS));
  const stepMs = Math.max(SLOT_GRANULARITY_MS, startStepMinutes * 60 * 1000);

  return schedule.map((day) => {
    const openSlots = new Set(day.openSlotStartsUtc.map((d) => d.getTime()));
    // Offer starts only on the admin's step (e.g. hourly), measured from the
    // day's opening; the atomic occupancy/buffer checks stay at 15 min.
    const dayOpenMs = day.openSlotStartsUtc[0]?.getTime() ?? 0;
    const offered = day.openSlotStartsUtc.filter((d) => (d.getTime() - dayOpenMs) % stepMs === 0);

    const starts: AvailableStart[] = offered.map((start) => {
      const startMs = start.getTime();
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
