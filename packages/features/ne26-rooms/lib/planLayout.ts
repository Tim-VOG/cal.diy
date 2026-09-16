/**
 * Where each booking sits on the rooms × hours plan, to the minute.
 *
 * The calendar this replaces drew a booking only when its start fell exactly on
 * one of its columns — hourly by default. Starts chain around the 15-minute
 * cleaning gap (09:00, 10:15, 11:30…), so most bookings after the first of the
 * day started between columns and were simply not drawn: the room looked free
 * to the desk while it was sold. A booking that was cancelled and one that
 * replaced it on the same slot also shared a lookup key, and whichever came
 * last hid the other.
 *
 * Positions are percentages of the day's opening window, so the same layout
 * holds at any width. Pure, so the one thing that must not happen — a sold room
 * drawn as free — is testable.
 */

export interface PlanBooking {
  uid: string;
  roomName: string;
  status: string;
  startUtc: string;
  endUtc: string;
}

export interface PlanBlock<T extends PlanBooking = PlanBooking> {
  booking: T;
  /** Left edge, % of the day's window. */
  left: number;
  /** Width, % of the day's window. */
  width: number;
  /** The cleaning gap after it, % of the window; 0 when it would start at closing. */
  cleaningWidth: number;
  /** Began before opening or runs past closing, and was cut to the window. */
  clipped: boolean;
  /**
   * Overlaps another live booking in the same room. The database's unique slot
   * index should make this impossible; if it ever shows, it must be seen rather
   * than drawn one on top of the other.
   */
  conflict: boolean;
}

export interface PlanRow<T extends PlanBooking = PlanBooking> {
  roomName: string;
  blocks: PlanBlock<T>[];
}

/** Statuses whose slots are released: nothing to draw, the room is free again. */
const RELEASED = new Set(["CANCELLED"]);

export function planLayout<T extends PlanBooking>(input: {
  bookings: T[];
  roomNames: string[];
  openUtc: Date;
  closeUtc: Date;
  bufferMinutes: number;
}): PlanRow<T>[] {
  const open = input.openUtc.getTime();
  const close = input.closeUtc.getTime();
  const span = close - open;
  if (span <= 0) return input.roomNames.map((roomName) => ({ roomName, blocks: [] }));
  const pct = (ms: number) => (ms / span) * 100;
  const bufferMs = Math.max(0, input.bufferMinutes) * 60 * 1000;

  return input.roomNames.map((roomName) => {
    const live = input.bookings
      .filter((b) => b.roomName === roomName && !RELEASED.has(b.status))
      .map((b) => ({ b, start: new Date(b.startUtc).getTime(), end: new Date(b.endUtc).getTime() }))
      // Only what touches this day's window.
      .filter(({ start, end }) => end > open && start < close)
      .sort((x, y) => x.start - y.start);

    const blocks = live.map(({ b, start, end }, i) => {
      const from = Math.max(start, open);
      const to = Math.min(end, close);
      const cleaningTo = Math.min(end + bufferMs, close);
      const overlaps = live.some((other, j) => j !== i && other.start < end && start < other.end);
      return {
        booking: b,
        left: pct(from - open),
        width: pct(to - from),
        cleaningWidth: end < close ? pct(cleaningTo - end) : 0,
        clipped: start < open || end > close,
        conflict: overlaps,
      };
    });
    return { roomName, blocks };
  });
}
