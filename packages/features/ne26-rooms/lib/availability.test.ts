import { describe, expect, it } from "vitest";
import { computeAvailability } from "./availability";

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

describe("computeAvailability (15-min slots)", () => {
  it("covers the three event days", () => {
    expect(computeAvailability([], 0).map((d) => d.date)).toEqual(["2026-11-17", "2026-11-18", "2026-11-19"]);
  });

  it("exposes 15-minute starts within the Tuesday window (14:00-17:00 Brussels = 13:00-16:00 UTC)", () => {
    const days = computeAvailability([], 0);
    const tue = findDay(days, "2026-11-17");
    expect(tue.starts).toHaveLength(12); // 3h window / 15min
    expect(tue.starts[0].startUtc).toBe("2026-11-17T13:00:00.000Z");
    expect(durations(days, "2026-11-17", "2026-11-17T13:00:00.000Z")).toEqual([1, 2, 3]);
  });

  it("shrinks durations that would overrun the close hour", () => {
    const days = computeAvailability([], 0);
    // 13:15 + 3h = 16:15 UTC overruns the 16:00 close, so only 1h/2h fit.
    expect(durations(days, "2026-11-17", "2026-11-17T13:15:00.000Z")).toEqual([1, 2]);
    // 15:00 + 1h ends exactly at close; 2h would overrun.
    expect(durations(days, "2026-11-17", "2026-11-17T15:00:00.000Z")).toEqual([1]);
    // 15:45 + 1h overruns -> nothing.
    expect(durations(days, "2026-11-17", "2026-11-17T15:45:00.000Z")).toEqual([]);
  });

  it("blocks starts taken by a booking and its reserved buffer", () => {
    // A confirmed 1h booking at 13:00 reserves its slots + a 15-min buffer (14:00).
    const taken = [
      new Date("2026-11-17T13:00:00.000Z"),
      new Date("2026-11-17T13:15:00.000Z"),
      new Date("2026-11-17T13:30:00.000Z"),
      new Date("2026-11-17T13:45:00.000Z"),
      new Date("2026-11-17T14:00:00.000Z"), // buffer
    ];
    const days = computeAvailability(taken, 15);
    expect(durations(days, "2026-11-17", "2026-11-17T13:00:00.000Z")).toEqual([]); // taken
    expect(durations(days, "2026-11-17", "2026-11-17T14:00:00.000Z")).toEqual([]); // buffer-blocked
    expect(durations(days, "2026-11-17", "2026-11-17T14:15:00.000Z")).toContain(1); // first free start
  });

  it("keeps a new booking's own trailing buffer clear of the next booking", () => {
    // An existing booking occupies 14:15. A new 1h booking at 13:15 ends 14:15,
    // whose 15-min buffer (14:15) would collide -> 1h not offered there.
    const days = computeAvailability([new Date("2026-11-17T14:15:00.000Z")], 15);
    expect(durations(days, "2026-11-17", "2026-11-17T13:00:00.000Z")).toContain(1); // buffer (14:00) free
    expect(durations(days, "2026-11-17", "2026-11-17T13:15:00.000Z")).not.toContain(1); // buffer (14:15) taken
  });

  it("opens the full Wednesday window (09:00-17:00 Brussels = 32 slots)", () => {
    const days = computeAvailability([], 0);
    const wed = findDay(days, "2026-11-18");
    expect(wed.starts).toHaveLength(32);
    expect(wed.starts[0].startUtc).toBe("2026-11-18T08:00:00.000Z");
    expect(durations(days, "2026-11-18", "2026-11-18T08:00:00.000Z")).toEqual([1, 2, 3]);
  });

  it("caps Thursday to its short window (09:00-11:00 Brussels)", () => {
    const days = computeAvailability([], 0);
    const thu = findDay(days, "2026-11-19");
    expect(thu.starts).toHaveLength(8); // 2h window / 15min
    expect(durations(days, "2026-11-19", "2026-11-19T08:00:00.000Z")).toEqual([1, 2]); // 3h overruns
  });
});
