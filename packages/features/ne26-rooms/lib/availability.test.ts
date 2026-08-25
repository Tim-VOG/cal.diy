import { describe, expect, it } from "vitest";
import { computeAvailability } from "./availability";

/**
 * Event-local time as a UTC instant.
 *
 * The event runs in Istanbul (UTC+3, no DST) while the database and this
 * function work in UTC. Writing "11:00Z" in a test hides which local hour is
 * meant, and that is exactly what made the whole suite need rewriting when the
 * event moved country — so the tests say 14:00 and convert here.
 */
function at(date: string, localHour: number, localMinute = 0): string {
  const utcMinutes = localHour * 60 + localMinute - 3 * 60;
  const hh = String(Math.floor(utcMinutes / 60)).padStart(2, "0");
  const mm = String(utcMinutes % 60).padStart(2, "0");
  return `${date}T${hh}:${mm}:00.000Z`;
}
const TUE = "2026-11-17";
const WED = "2026-11-18";
const THU = "2026-11-19";

/** Fixed instant before the event, so the "past start" rule never interferes. */
const BEFORE_EVENT = new Date("2026-11-01T00:00:00.000Z");

type Result = ReturnType<typeof computeAvailability>;

function findDay(result: Result, date: string) {
  const day = result.find((d) => d.date === date);
  if (!day) throw new Error(`day ${date} not found`);
  return day;
}
function durations(result: Result, date: string, startUtc: string): number[] {
  const start = findDay(result, date).starts.find((s) => s.startUtc === startUtc);
  if (!start) throw new Error(`start ${startUtc} not found`);
  return start.availableDurations;
}
/** Starts offered for one duration, which is what a buyer actually sees. */
function startsFor(result: Result, date: string, duration: number): string[] {
  return findDay(result, date)
    .starts.filter((s) => s.availableDurations.includes(duration as 1 | 2 | 3))
    .map((s) => s.startUtc);
}

describe("computeAvailability", () => {
  it("covers the three event days", () => {
    expect(computeAvailability([], 0, BEFORE_EVENT).map((d) => d.date)).toEqual([TUE, WED, THU]);
  });

  it("offers hourly starts when no cleaning gap is configured", () => {
    // Degenerate case of the chain: nothing to leave between bookings, so the
    // chain and the clock agree. Tuesday opens 14:00-17:00 local.
    expect(startsFor(computeAvailability([], 0, BEFORE_EVENT), TUE, 1)).toEqual([
      at(TUE, 14),
      at(TUE, 15),
      at(TUE, 16),
    ]);
  });

  it("opens the full Wednesday window (09:00-17:00 = 8 hourly starts)", () => {
    const days = computeAvailability([], 0, BEFORE_EVENT);
    expect(startsFor(days, WED, 1)).toHaveLength(8);
    expect(durations(days, WED, at(WED, 9))).toEqual([1, 2, 3]);
  });

  it("caps Thursday to its short window (09:00-11:00 local)", () => {
    const days = computeAvailability([], 0, BEFORE_EVENT);
    expect(startsFor(days, THU, 1)).toHaveLength(2);
    expect(durations(days, THU, at(THU, 9))).toEqual([1, 2]);
  });

  it("never offers a duration that would overrun the close hour", () => {
    const days = computeAvailability([], 0, BEFORE_EVENT);
    expect(durations(days, TUE, at(TUE, 16))).toEqual([1]); // 2h would run past 17:00
  });
});

describe("computeAvailability — offered times chain, cleaning gap included", () => {
  it("steps by the booking plus the gap, so every offer is a full hour", () => {
    // Listing every hour would advertise a 10:00 slot with only 45 free minutes
    // behind it; the chain offers the hour that can actually be sold.
    const days = computeAvailability([], 15, BEFORE_EVENT);
    expect(startsFor(days, WED, 1)).toEqual([
      at(WED, 9),
      at(WED, 10, 15),
      at(WED, 11, 30),
      at(WED, 12, 45),
      at(WED, 14),
      at(WED, 15, 15),
    ]);
  });

  it("chains two-hour bookings on their own rhythm", () => {
    const days = computeAvailability([], 15, BEFORE_EVENT);
    expect(startsFor(days, WED, 2)).toEqual([
      at(WED, 9), // 09:00-11:00
      at(WED, 11, 15), // 11:15-13:15
      at(WED, 13, 30), // 13:30-15:30
    ]);
  });

  it("re-anchors the chain after a booking that is already there", () => {
    // Sold 14:00-15:00 local, holding its cleaning gap to 15:15.
    const sold = [
      new Date(at(TUE, 14)),
      new Date(at(TUE, 14, 15)),
      new Date(at(TUE, 14, 30)),
      new Date(at(TUE, 14, 45)),
      new Date(at(TUE, 15)), // cleaning
    ];
    expect(startsFor(computeAvailability(sold, 15, BEFORE_EVENT), TUE, 1)).toEqual([
      at(TUE, 15, 15), // the moment the room is clean
    ]);
  });

  it("leaves a cleaning gap before an existing booking too", () => {
    // Something already sits at 15:00-16:00 local. A booking ending flush
    // against it at 15:00 would leave no time to clean.
    const at3pm = [
      new Date(at(TUE, 15)),
      new Date(at(TUE, 15, 15)),
      new Date(at(TUE, 15, 30)),
      new Date(at(TUE, 15, 45)),
    ];
    const offered = startsFor(computeAvailability(at3pm, 15, BEFORE_EVENT), TUE, 1);
    expect(offered).not.toContain(at(TUE, 14));
    // The hour after it is still fine — the gap belongs to whoever comes first.
    expect(offered).toContain(at(TUE, 16));
  });

  it("offers nothing at all once the room is full", () => {
    const wholeTuesday = Array.from({ length: 12 }, (_, i) => new Date(at(TUE, 14, i * 15)));
    expect(findDay(computeAvailability(wholeTuesday, 15, BEFORE_EVENT), TUE).starts).toEqual([]);
  });
});

describe("computeAvailability — a start in the past is never sellable", () => {
  // Mid-event: Wednesday 18 Nov, 10:30 local. This is the state the hostess
  // tablet and any broadcast link are in during the event.
  const MID_EVENT = new Date(at(WED, 10, 30));

  it("drops the starts already begun and re-anchors on now", () => {
    const offered = startsFor(computeAvailability([], 0, MID_EVENT), WED, 1);
    expect(offered).not.toContain(at(WED, 9)); // long gone
    expect(offered).not.toContain(at(WED, 10)); // 30 minutes ago
    expect(offered[0]).toBe(at(WED, 10, 30)); // right now
  });

  it("offers a start landing exactly on now", () => {
    const days = computeAvailability([], 0, new Date(at(WED, 11)));
    expect(durations(days, WED, at(WED, 11))).toEqual([1, 2, 3]);
  });

  it("closes a whole past day, so day 1 can never be sold on day 2", () => {
    expect(findDay(computeAvailability([], 0, MID_EVENT), TUE).starts).toEqual([]);
  });

  it("closes the entire event once it is over", () => {
    const days = computeAvailability([], 0, new Date("2026-11-20T00:00:00.000Z"));
    expect(days.flatMap((d) => d.starts)).toEqual([]);
  });
});
