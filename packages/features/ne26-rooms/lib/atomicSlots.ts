import { ErrorCode } from "@calcom/lib/errorCodes";
import { ErrorWithCode } from "@calcom/lib/errors";
import { SLOT_GRANULARITY_MS } from "./eventSchedule";

export const ALLOWED_DURATIONS_MINUTES = [60, 120, 180] as const;
export type AllowedDurationMinutes = (typeof ALLOWED_DURATIONS_MINUTES)[number];

function isAllowedDuration(durationMinutes: number): durationMinutes is AllowedDurationMinutes {
  return (ALLOWED_DURATIONS_MINUTES as readonly number[]).includes(durationMinutes);
}

/**
 * Split a booking into the start times of the atomic slots it occupies, at
 * SLOT_GRANULARITY (15 min). A 1h booking at 09:00 -> [09:00, 09:15, 09:30, 09:45].
 *
 * Each returned mark maps to one ResourceSlot row guarded by
 * @@unique([resourceId, slotStart]); this is how overlapping bookings are made
 * mutually exclusive without comparing intervals (brief §4.3 Option A).
 */
export function getAtomicSlotStarts(startTime: Date, durationMinutes: number): Date[] {
  if (!isAllowedDuration(durationMinutes)) {
    throw new ErrorWithCode(
      ErrorCode.BadRequest,
      `Unsupported duration: ${durationMinutes} minutes (allowed: ${ALLOWED_DURATIONS_MINUTES.join(", ")})`
    );
  }
  // Bookings must start on a slot boundary. Europe/Istanbul is a whole-hour
  // offset, so a local boundary is also a UTC boundary.
  if (startTime.getTime() % SLOT_GRANULARITY_MS !== 0) {
    throw new ErrorWithCode(
      ErrorCode.BadRequest,
      `Booking must start on a ${SLOT_GRANULARITY_MS / 60000}-minute boundary, received ${startTime.toISOString()}`
    );
  }

  const count = (durationMinutes * 60 * 1000) / SLOT_GRANULARITY_MS;
  const slotStarts: Date[] = [];
  for (let i = 0; i < count; i++) {
    slotStarts.push(new Date(startTime.getTime() + i * SLOT_GRANULARITY_MS));
  }
  return slotStarts;
}

/**
 * The atomic slot marks reserved as a turnover buffer AFTER a booking ends.
 * Reserving these blocks the next booking from starting within `bufferMinutes`,
 * which guarantees a gap between consecutive bookings of the same room.
 * Returns [] when there is no buffer.
 */
export function getBufferSlotStarts(startTime: Date, durationMinutes: number, bufferMinutes: number): Date[] {
  if (bufferMinutes <= 0) return [];
  const endMs = startTime.getTime() + durationMinutes * 60 * 1000;
  const count = Math.ceil((bufferMinutes * 60 * 1000) / SLOT_GRANULARITY_MS);
  const bufferStarts: Date[] = [];
  for (let i = 0; i < count; i++) {
    bufferStarts.push(new Date(endMs + i * SLOT_GRANULARITY_MS));
  }
  return bufferStarts;
}
