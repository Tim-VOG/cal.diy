import { describe, expect, it } from "vitest";

import { computeAvailability } from "./availability";

function findDay(result: ReturnType<typeof computeAvailability>, date: string) {
  const day = result.find((d) => d.date === date);
  if (!day) throw new Error(`day ${date} not found`);
  return day;
}

describe("computeAvailability", () => {
  it("covers the three event days", () => {
    const days = computeAvailability([]);
    expect(days.map((d) => d.date)).toEqual(["2026-11-17", "2026-11-18", "2026-11-19"]);
  });

  it("shrinks longer durations near the end of a day's window (Tue 14:00-17:00 Brussels)", () => {
    // Brussels 14/15/16 -> UTC 13/14/15.
    const day = findDay(computeAvailability([]), "2026-11-17");
    expect(day.starts).toEqual([
      { startUtc: "2026-11-17T13:00:00.000Z", availableDurations: [1, 2, 3] },
      { startUtc: "2026-11-17T14:00:00.000Z", availableDurations: [1, 2] },
      { startUtc: "2026-11-17T15:00:00.000Z", availableDurations: [1] },
    ]);
  });

  it("removes a taken hour and any longer duration spanning it", () => {
    // Book the 15:00 Brussels hour (= 14:00 UTC) on Tuesday.
    const day = findDay(computeAvailability([new Date("2026-11-17T14:00:00.000Z")]), "2026-11-17");
    expect(day.starts).toEqual([
      { startUtc: "2026-11-17T13:00:00.000Z", availableDurations: [1] }, // 2h/3h would span the taken 14:00 UTC
      { startUtc: "2026-11-17T14:00:00.000Z", availableDurations: [] }, // taken
      { startUtc: "2026-11-17T15:00:00.000Z", availableDurations: [1] },
    ]);
  });

  it("opens the full window on Wednesday (09:00-17:00 Brussels = 8 atomic hours)", () => {
    const day = findDay(computeAvailability([]), "2026-11-18");
    expect(day.starts).toHaveLength(8);
    expect(day.starts[0].startUtc).toBe("2026-11-18T08:00:00.000Z"); // 09:00 Brussels
    expect(day.starts[0].availableDurations).toEqual([1, 2, 3]);
  });

  it("caps Thursday to its short window (09:00-11:00 Brussels)", () => {
    const day = findDay(computeAvailability([]), "2026-11-19");
    expect(day.starts).toEqual([
      { startUtc: "2026-11-19T08:00:00.000Z", availableDurations: [1, 2] }, // 09:00 Brussels, 3h would overrun 11:00
      { startUtc: "2026-11-19T09:00:00.000Z", availableDurations: [1] }, // 10:00 Brussels
    ]);
  });
});
