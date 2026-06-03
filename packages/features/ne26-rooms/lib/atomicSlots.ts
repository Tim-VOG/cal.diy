import { ErrorCode } from "@calcom/lib/errorCodes";
import { ErrorWithCode } from "@calcom/lib/errors";

export const ALLOWED_DURATIONS_MINUTES = [60, 120, 180] as const;
export type AllowedDurationMinutes = (typeof ALLOWED_DURATIONS_MINUTES)[number];

const MS_PER_HOUR = 60 * 60 * 1000;

function isAllowedDuration(durationMinutes: number): durationMinutes is AllowedDurationMinutes {
  return (ALLOWED_DURATIONS_MINUTES as readonly number[]).includes(durationMinutes);
}

/**
 * Split a booking into the start times of the atomic 1h slots it occupies.
 * A 3h booking starting at 09:00 UTC -> [09:00, 10:00, 11:00].
 *
 * Each returned slot start maps to one ResourceSlot row guarded by
 * @@unique([resourceId, slotStart]); this is how overlapping 1/2/3h durations
 * are made mutually exclusive without comparing intervals (brief §4.3 Option A).
 */
export function getAtomicSlotStarts(startTime: Date, durationMinutes: number): Date[] {
  if (!isAllowedDuration(durationMinutes)) {
    throw new ErrorWithCode(
      ErrorCode.BadRequest,
      `Unsupported duration: ${durationMinutes} minutes (allowed: ${ALLOWED_DURATIONS_MINUTES.join(", ")})`
    );
  }
  // Atomic slots are whole UTC hours, so a booking must start on the hour.
  // Europe/Brussels is a whole-hour offset, so a local :00 is also a UTC :00.
  if (startTime.getTime() % MS_PER_HOUR !== 0) {
    throw new ErrorWithCode(
      ErrorCode.BadRequest,
      `Booking must start on a full hour, received ${startTime.toISOString()}`
    );
  }

  const hours = durationMinutes / 60;
  const slotStarts: Date[] = [];
  for (let hour = 0; hour < hours; hour++) {
    slotStarts.push(new Date(startTime.getTime() + hour * MS_PER_HOUR));
  }
  return slotStarts;
}
