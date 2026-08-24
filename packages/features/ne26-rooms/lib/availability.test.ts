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
function offeredStarts(result: Result, date: string): string[] {
  return findDay(result, date).starts.map((s) => s.startUtc);
}

describe("computeAvailability", () => {
  it("covers the three event days", () => {
    expect(computeAvailability([], 0, BEFORE_EVENT).map((d) => d.date)).toEqual([
      "2026-11-17",
      "2026-11-18",
      "2026-11-19",
    ]);
  });

  it("offers hourly starts on an empty day — Tuesday 14:00-17:00 Brussels", () => {
    const days = computeAvailability([], 0, BEFORE_EVENT);
    expect(offeredStarts(days, "2026-11-17")).toEqual([
      "2026-11-17T13:00:00.000Z",
      "2026-11-17T14:00:00.000Z",
      "2026-11-17T15:00:00.000Z",
    ]);
    expect(durations(days, "2026-11-17", "2026-11-17T13:00:00.000Z")).toEqual([1, 2, 3]);
  });

  it("shrinks durations that would overrun the close hour", () => {
    const days = computeAvailability([], 0, BEFORE_EVENT);
    expect(durations(days, "2026-11-17", "2026-11-17T15:00:00.000Z")).toEqual([1]); // 2h overruns 16:00 UTC
  });

  it("opens the full Wednesday window hourly (09:00-17:00 = 8 starts)", () => {
    const days = computeAvailability([], 0, BEFORE_EVENT);
    const wed = findDay(days, "2026-11-18");
    expect(wed.starts).toHaveLength(8);
    expect(wed.starts[0].startUtc).toBe("2026-11-18T08:00:00.000Z");
    expect(durations(days, "2026-11-18", "2026-11-18T08:00:00.000Z")).toEqual([1, 2, 3]);
  });

  it("caps Thursday to its short window (09:00-11:00 Brussels)", () => {
    const days = computeAvailability([], 0, BEFORE_EVENT);
    expect(findDay(days, "2026-11-19").starts).toHaveLength(2);
    expect(durations(days, "2026-11-19", "2026-11-19T08:00:00.000Z")).toEqual([1, 2]);
  });
});

describe("computeAvailability — the room comes back on sale as soon as it is clean", () => {
  // One hour sold from 14:00 Brussels (13:00 UTC), plus the 15-minute cleaning
  // gap it reserves at 15:00 Brussels (14:00 UTC).
  const SOLD_2PM = [
    new Date("2026-11-17T13:00:00.000Z"),
    new Date("2026-11-17T13:15:00.000Z"),
    new Date("2026-11-17T13:30:00.000Z"),
    new Date("2026-11-17T13:45:00.000Z"),
    new Date("2026-11-17T14:00:00.000Z"), // cleaning
  ];

  it("offers the moment the room frees up, not just the next hour", () => {
    // The point of the whole rule: hourly-only jumped from 14:00 straight to
    // 16:00 Brussels, leaving 15:15-16:15 unsellable in an empty room.
    const days = computeAvailability(SOLD_2PM, 15, BEFORE_EVENT);
    expect(offeredStarts(days, "2026-11-17")).toContain("2026-11-17T14:15:00.000Z");
    expect(durations(days, "2026-11-17", "2026-11-17T14:15:00.000Z")).toEqual([1]);
  });

  it("still refuses what is actually taken", () => {
    const days = computeAvailability(SOLD_2PM, 15, BEFORE_EVENT);
    expect(durations(days, "2026-11-17", "2026-11-17T13:00:00.000Z")).toEqual([]); // sold
    expect(durations(days, "2026-11-17", "2026-11-17T14:00:00.000Z")).toEqual([]); // cleaning
  });

  it("adds exactly one resume start, not a quarter-hourly grid", () => {
    // Otherwise the buyer is handed a wall of near-identical buttons.
    const days = computeAvailability(SOLD_2PM, 15, BEFORE_EVENT);
    expect(offeredStarts(days, "2026-11-17")).toEqual([
      "2026-11-17T13:00:00.000Z",
      "2026-11-17T14:00:00.000Z",
      "2026-11-17T14:15:00.000Z",
      "2026-11-17T15:00:00.000Z",
    ]);
  });

  it("adds nothing extra to a day with no bookings", () => {
    const days = computeAvailability([], 15, BEFORE_EVENT);
    expect(offeredStarts(days, "2026-11-17")).toEqual([
      "2026-11-17T13:00:00.000Z",
      "2026-11-17T14:00:00.000Z",
      "2026-11-17T15:00:00.000Z",
    ]);
  });

  it("keeps a new booking's own cleaning gap clear of the next one", () => {
    const days = computeAvailability([new Date("2026-11-17T14:15:00.000Z")], 15, BEFORE_EVENT);
    expect(durations(days, "2026-11-17", "2026-11-17T13:00:00.000Z")).toContain(1); // gap at 14:00 free
  });

  it("resumes with no cleaning gap configured", () => {
    const soldNoBuffer = SOLD_2PM.slice(0, 4);
    const days = computeAvailability(soldNoBuffer, 0, BEFORE_EVENT);
    // The room frees at 14:00, which is already an hourly start — nothing extra.
    expect(offeredStarts(days, "2026-11-17")).toEqual([
      "2026-11-17T13:00:00.000Z",
      "2026-11-17T14:00:00.000Z",
      "2026-11-17T15:00:00.000Z",
    ]);
    expect(durations(days, "2026-11-17", "2026-11-17T14:00:00.000Z")).toEqual([1, 2]);
  });
});

describe("computeAvailability — a start in the past is never sellable", () => {
  // Mid-event: Wednesday 18 Nov, 10:30 Brussels (09:30 UTC). This is the state
  // the hostess tablet and any broadcast link are in during the event.
  const MID_EVENT = new Date("2026-11-18T09:30:00.000Z");

  it("closes every start already begun today, and keeps the later ones", () => {
    const days = computeAvailability([], 0, MID_EVENT);
    expect(durations(days, "2026-11-18", "2026-11-18T08:00:00.000Z")).toEqual([]); // 09:00, long gone
    expect(durations(days, "2026-11-18", "2026-11-18T09:00:00.000Z")).toEqual([]); // 30 min ago
    expect(durations(days, "2026-11-18", "2026-11-18T10:00:00.000Z")).toEqual([1, 2, 3]); // still sellable
  });

  it("offers a start landing exactly on now", () => {
    const days = computeAvailability([], 0, new Date("2026-11-18T10:00:00.000Z"));
    expect(durations(days, "2026-11-18", "2026-11-18T10:00:00.000Z")).toEqual([1, 2, 3]);
  });

  it("closes a whole past day, so day 1 can never be sold on day 2", () => {
    const tuesday = findDay(computeAvailability([], 0, MID_EVENT), "2026-11-17");
    expect(tuesday.starts.every((s) => s.availableDurations.length === 0)).toBe(true);
  });

  it("closes the entire event once it is over", () => {
    const days = computeAvailability([], 0, new Date("2026-11-20T00:00:00.000Z"));
    expect(days.flatMap((d) => d.starts).every((s) => s.availableDurations.length === 0)).toBe(true);
  });
});
