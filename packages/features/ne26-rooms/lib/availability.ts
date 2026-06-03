import { EVENT_SCHEDULE, SELECTABLE_DURATIONS, type DurationHours } from "./eventSchedule";

const MS_PER_HOUR = 60 * 60 * 1000;

export interface AvailableStart {
  /** Atomic 1h slot start, in UTC (ISO 8601). */
  startUtc: string;
  /** Durations (in hours) bookable from this start — a subset of [1, 2, 3]. */
  availableDurations: DurationHours[];
}

export interface EventDayAvailability {
  date: string;
  starts: AvailableStart[];
}

/**
 * Compute, per event day, which (start hour, duration) combinations are still
 * bookable for one room given the atomic hours already taken.
 *
 * A duration is offered from a start hour only if every atomic hour it spans is
 * (a) within that day's opening window and (b) not already taken — which is how
 * overlapping 1/2/3h bookings are kept mutually exclusive (brief §4.3).
 *
 * @param takenSlotStartsUtc atomic hour starts occupied by CONFIRMED or
 *   actively-held PENDING bookings for the room (caller resolves "active hold").
 */
export function computeAvailability(takenSlotStartsUtc: Date[]): EventDayAvailability[] {
  const taken = new Set(takenSlotStartsUtc.map((d) => d.getTime()));

  return EVENT_SCHEDULE.map((day) => {
    const openHours = new Set(day.sellableHourStartsUtc.map((d) => d.getTime()));

    const starts: AvailableStart[] = day.sellableHourStartsUtc.map((start) => {
      const startMs = start.getTime();
      const availableDurations = SELECTABLE_DURATIONS.filter((duration) => {
        for (let hour = 0; hour < duration; hour++) {
          const hourMs = startMs + hour * MS_PER_HOUR;
          if (!openHours.has(hourMs) || taken.has(hourMs)) return false;
        }
        return true;
      });
      return { startUtc: start.toISOString(), availableDurations: [...availableDurations] };
    });

    return { date: day.date, starts };
  });
}
