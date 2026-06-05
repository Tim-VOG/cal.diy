import { describe, expect, it } from "vitest";
import {
  buildEventSchedule,
  buildOpenSlotMs,
  DEFAULT_EVENT_DAYS,
  normalizeEventDays,
  SLOT_GRANULARITY_MINUTES,
} from "./eventSchedule";

describe("normalizeEventDays", () => {
  it("falls back to defaults for non-array / empty / malformed input", () => {
    expect(normalizeEventDays(null)).toEqual(DEFAULT_EVENT_DAYS);
    expect(normalizeEventDays("nope")).toEqual(DEFAULT_EVENT_DAYS);
    expect(normalizeEventDays([])).toEqual(DEFAULT_EVENT_DAYS);
    expect(normalizeEventDays([{ date: "2026-11-17", openHourBrussels: 5 }])).toEqual(DEFAULT_EVENT_DAYS);
  });

  it("rejects days whose open hour is not before close hour", () => {
    expect(normalizeEventDays([{ date: "2026-11-17", openHourBrussels: 17, closeHourBrussels: 17 }])).toEqual(
      DEFAULT_EVENT_DAYS
    );
  });

  it("keeps valid days", () => {
    const days = [{ date: "2026-11-20", openHourBrussels: 8, closeHourBrussels: 12 }];
    expect(normalizeEventDays(days)).toEqual(days);
  });
});

describe("buildEventSchedule", () => {
  it("materialises atomic slot marks within the Brussels window in UTC", () => {
    const [day] = buildEventSchedule([{ date: "2026-11-17", openHourBrussels: 14, closeHourBrussels: 15 }]);
    // 14:00–15:00 Brussels (CET) → 13:00–14:00 UTC, at 15-min marks (exclusive close).
    const expectedCount = 60 / SLOT_GRANULARITY_MINUTES;
    expect(day.openSlotStartsUtc).toHaveLength(expectedCount);
    expect(day.openSlotStartsUtc[0].toISOString()).toBe("2026-11-17T13:00:00.000Z");
    expect(day.openSlotStartsUtc.at(-1)?.toISOString()).toBe("2026-11-17T13:45:00.000Z");
  });

  it("reflects custom opening hours (extending the window adds marks)", () => {
    const schedule = buildEventSchedule([{ date: "2026-11-19", openHourBrussels: 9, closeHourBrussels: 18 }]);
    const openMs = buildOpenSlotMs(schedule);
    // 17:00 Brussels = 16:00 UTC is now open, which the default 9–11 window excluded.
    expect(openMs.has(new Date("2026-11-19T16:00:00.000Z").getTime())).toBe(true);
  });
});
