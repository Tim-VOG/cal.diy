import { describe, expect, it } from "vitest";
import { computeAvailability } from "./availability";

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
    expect(computeAvailability([], 0, BEFORE_EVENT).map((d) => d.date)).toEqual([
      "2026-11-17",
      "2026-11-18",
      "2026-11-19",
    ]);
  });

  it("runs hourly when no cleaning gap is configured", () => {
    // Degenerate case of the chain: nothing to leave between bookings, so the
    // chain and the clock agree.
    expect(startsFor(computeAvailability([], 0, BEFORE_EVENT), "2026-11-17", 1)).toEqual([
      "2026-11-17T13:00:00.000Z",
      "2026-11-17T14:00:00.000Z",
      "2026-11-17T15:00:00.000Z",
    ]);
  });

  it("opens the full Wednesday window (09:00-17:00 = 8 hourly starts)", () => {
    const days = computeAvailability([], 0, BEFORE_EVENT);
    expect(startsFor(days, "2026-11-18", 1)).toHaveLength(8);
    expect(durations(days, "2026-11-18", "2026-11-18T08:00:00.000Z")).toEqual([1, 2, 3]);
  });

  it("caps Thursday to its short window (09:00-11:00 Brussels)", () => {
    const days = computeAvailability([], 0, BEFORE_EVENT);
    expect(startsFor(days, "2026-11-19", 1)).toHaveLength(2);
    expect(durations(days, "2026-11-19", "2026-11-19T08:00:00.000Z")).toEqual([1, 2]);
  });

  it("never offers a duration that would overrun the close hour", () => {
    const days = computeAvailability([], 0, BEFORE_EVENT);
    expect(durations(days, "2026-11-17", "2026-11-17T15:00:00.000Z")).toEqual([1]);
  });
});

describe("computeAvailability — offered times chain, cleaning gap included", () => {
  it("steps by the booking plus the gap, so every offer is a full hour", () => {
    // Wednesday, 09:00-17:00 Brussels, 15 minutes between bookings. Listing
    // every hour would advertise a 10:00 slot with only 45 free minutes behind
    // it; the chain offers the hour that can actually be sold.
    const days = computeAvailability([], 15, BEFORE_EVENT);
    expect(startsFor(days, "2026-11-18", 1)).toEqual([
      "2026-11-18T08:00:00.000Z", // 09:00
      "2026-11-18T09:15:00.000Z", // 10:15
      "2026-11-18T10:30:00.000Z", // 11:30
      "2026-11-18T11:45:00.000Z", // 12:45
      "2026-11-18T13:00:00.000Z", // 14:00
      "2026-11-18T14:15:00.000Z", // 15:15
    ]);
  });

  it("chains two-hour bookings on their own rhythm", () => {
    const days = computeAvailability([], 15, BEFORE_EVENT);
    expect(startsFor(days, "2026-11-18", 2)).toEqual([
      "2026-11-18T08:00:00.000Z", // 09:00-11:00
      "2026-11-18T10:15:00.000Z", // 11:15-13:15
      "2026-11-18T12:30:00.000Z", // 13:30-15:30
    ]);
  });

  it("re-anchors the chain after a booking that is already there", () => {
    // Sold 14:00-15:00 Brussels, holding its cleaning gap to 15:15.
    const sold = [
      new Date("2026-11-17T13:00:00.000Z"),
      new Date("2026-11-17T13:15:00.000Z"),
      new Date("2026-11-17T13:30:00.000Z"),
      new Date("2026-11-17T13:45:00.000Z"),
      new Date("2026-11-17T14:00:00.000Z"), // cleaning
    ];
    expect(startsFor(computeAvailability(sold, 15, BEFORE_EVENT), "2026-11-17", 1)).toEqual([
      "2026-11-17T14:15:00.000Z", // 15:15, the moment the room is clean
    ]);
  });

  it("leaves a cleaning gap before an existing booking too", () => {
    // Something already sits at 15:00-16:00 Brussels. A booking ending flush
    // against it at 15:00 would leave no time to clean.
    const at3pm = [
      new Date("2026-11-17T14:00:00.000Z"),
      new Date("2026-11-17T14:15:00.000Z"),
      new Date("2026-11-17T14:30:00.000Z"),
      new Date("2026-11-17T14:45:00.000Z"),
    ];
    const offered = startsFor(computeAvailability(at3pm, 15, BEFORE_EVENT), "2026-11-17", 1);
    // 14:00-15:00 Brussels would end exactly where the other booking starts.
    expect(offered).not.toContain("2026-11-17T13:00:00.000Z");
    // The hour after it is still fine — the gap belongs to whoever comes first.
    expect(offered).toContain("2026-11-17T15:00:00.000Z");
  });

  it("offers nothing at all once the room is full", () => {
    const wholeTuesday = Array.from({ length: 12 }, (_, i) => new Date(13 * 3600000 + i * 900000 + Date.UTC(2026, 10, 17)));
    const days = computeAvailability(wholeTuesday, 15, BEFORE_EVENT);
    expect(findDay(days, "2026-11-17").starts).toEqual([]);
  });
});

describe("computeAvailability — a start in the past is never sellable", () => {
  // Mid-event: Wednesday 18 Nov, 10:30 Brussels (09:30 UTC). This is the state
  // the hostess tablet and any broadcast link are in during the event.
  const MID_EVENT = new Date("2026-11-18T09:30:00.000Z");

  it("drops the starts already begun and re-anchors on now", () => {
    const offered = startsFor(computeAvailability([], 0, MID_EVENT), "2026-11-18", 1);
    expect(offered).not.toContain("2026-11-18T08:00:00.000Z"); // 09:00, long gone
    expect(offered).not.toContain("2026-11-18T09:00:00.000Z"); // 30 minutes ago
    expect(offered[0]).toBe("2026-11-18T09:30:00.000Z"); // right now
  });

  it("offers a start landing exactly on now", () => {
    const days = computeAvailability([], 0, new Date("2026-11-18T10:00:00.000Z"));
    expect(durations(days, "2026-11-18", "2026-11-18T10:00:00.000Z")).toEqual([1, 2, 3]);
  });

  it("closes a whole past day, so day 1 can never be sold on day 2", () => {
    expect(findDay(computeAvailability([], 0, MID_EVENT), "2026-11-17").starts).toEqual([]);
  });

  it("closes the entire event once it is over", () => {
    const days = computeAvailability([], 0, new Date("2026-11-20T00:00:00.000Z"));
    expect(days.flatMap((d) => d.starts)).toEqual([]);
  });
});
