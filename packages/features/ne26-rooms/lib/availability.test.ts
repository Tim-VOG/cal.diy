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

describe("computeAvailability", () => {
  it("covers the three event days", () => {
    expect(computeAvailability([], 0, 60, BEFORE_EVENT).map((d) => d.date)).toEqual(["2026-11-17", "2026-11-18", "2026-11-19"]);
  });

  it("offers hourly starts by default (step 60) — Tuesday 14:00-17:00 Brussels", () => {
    const tue = findDay(computeAvailability([], 0, 60, BEFORE_EVENT), "2026-11-17");
    expect(tue.starts.map((s) => s.startUtc)).toEqual([
      "2026-11-17T13:00:00.000Z",
      "2026-11-17T14:00:00.000Z",
      "2026-11-17T15:00:00.000Z",
    ]);
    expect(durations(computeAvailability([], 0, 60, BEFORE_EVENT), "2026-11-17", "2026-11-17T13:00:00.000Z")).toEqual([
      1, 2, 3,
    ]);
  });

  it("offers 15-min starts when the step is 15", () => {
    const days = computeAvailability([], 0, 15, BEFORE_EVENT);
    const tue = findDay(days, "2026-11-17");
    expect(tue.starts).toHaveLength(12); // 3h window / 15min
    expect(durations(days, "2026-11-17", "2026-11-17T13:15:00.000Z")).toEqual([1, 2]); // 3h overruns
  });

  it("shrinks durations that would overrun the close hour", () => {
    const days = computeAvailability([], 0, 60, BEFORE_EVENT);
    expect(durations(days, "2026-11-17", "2026-11-17T15:00:00.000Z")).toEqual([1]); // 2h overruns 16:00 UTC
  });

  it("blocks starts taken by a booking and its reserved buffer (15-min step)", () => {
    const taken = [
      new Date("2026-11-17T13:00:00.000Z"),
      new Date("2026-11-17T13:15:00.000Z"),
      new Date("2026-11-17T13:30:00.000Z"),
      new Date("2026-11-17T13:45:00.000Z"),
      new Date("2026-11-17T14:00:00.000Z"), // buffer
    ];
    const days = computeAvailability(taken, 15, 15, BEFORE_EVENT);
    expect(durations(days, "2026-11-17", "2026-11-17T13:00:00.000Z")).toEqual([]); // taken
    expect(durations(days, "2026-11-17", "2026-11-17T14:00:00.000Z")).toEqual([]); // buffer-blocked
    expect(durations(days, "2026-11-17", "2026-11-17T14:15:00.000Z")).toContain(1); // first free start
  });

  it("keeps a new booking's own trailing buffer clear of the next booking", () => {
    const days = computeAvailability([new Date("2026-11-17T14:15:00.000Z")], 15, 15, BEFORE_EVENT);
    expect(durations(days, "2026-11-17", "2026-11-17T13:00:00.000Z")).toContain(1); // buffer (14:00) free
    expect(durations(days, "2026-11-17", "2026-11-17T13:15:00.000Z")).not.toContain(1); // buffer (14:15) taken
  });

  it("opens the full Wednesday window hourly by default (09:00-17:00 = 8 starts)", () => {
    const wed = findDay(computeAvailability([], 0, 60, BEFORE_EVENT), "2026-11-18");
    expect(wed.starts).toHaveLength(8);
    expect(wed.starts[0].startUtc).toBe("2026-11-18T08:00:00.000Z");
    expect(durations(computeAvailability([], 0, 60, BEFORE_EVENT), "2026-11-18", "2026-11-18T08:00:00.000Z")).toEqual([
      1, 2, 3,
    ]);
  });

  it("caps Thursday to its short window (09:00-11:00 Brussels)", () => {
    const days = computeAvailability([], 0, 60, BEFORE_EVENT);
    const thu = findDay(days, "2026-11-19");
    expect(thu.starts).toHaveLength(2); // 2h window, hourly
    expect(durations(days, "2026-11-19", "2026-11-19T08:00:00.000Z")).toEqual([1, 2]); // 3h overruns
  });
});

describe("computeAvailability — a start in the past is never sellable", () => {
  // Mid-event: Wednesday 18 Nov, 10:30 Brussels (09:30 UTC). This is the state
  // the hostess tablet and any broadcast link are in during the event.
  const MID_EVENT = new Date("2026-11-18T09:30:00.000Z");

  it("closes every start already begun today, and keeps the later ones", () => {
    const days = computeAvailability([], 0, 15, MID_EVENT);
    expect(durations(days, "2026-11-18", "2026-11-18T08:00:00.000Z")).toEqual([]); // 09:00, long gone
    expect(durations(days, "2026-11-18", "2026-11-18T09:15:00.000Z")).toEqual([]); // 15 min ago
    expect(durations(days, "2026-11-18", "2026-11-18T09:45:00.000Z")).toEqual([1, 2, 3]); // still sellable
  });

  it("offers a start landing exactly on now", () => {
    const days = computeAvailability([], 0, 15, MID_EVENT);
    expect(durations(days, "2026-11-18", "2026-11-18T09:30:00.000Z")).toEqual([1, 2, 3]);
  });

  it("closes a whole past day, so day 1 can never be sold on day 2", () => {
    const tuesday = findDay(computeAvailability([], 0, 15, MID_EVENT), "2026-11-17");
    expect(tuesday.starts.every((s) => s.availableDurations.length === 0)).toBe(true);
  });

  it("closes the entire event once it is over", () => {
    const days = computeAvailability([], 0, 15, new Date("2026-11-20T00:00:00.000Z"));
    expect(days.flatMap((d) => d.starts).every((s) => s.availableDurations.length === 0)).toBe(true);
  });
});
