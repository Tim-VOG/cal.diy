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
    expect(normalizeEventDays([{ date: "2026-11-17", openHour: 5 }])).toEqual(DEFAULT_EVENT_DAYS);
  });

  it("rejects days whose open hour is not before close hour", () => {
    expect(normalizeEventDays([{ date: "2026-11-17", openHour: 17, closeHour: 17 }])).toEqual(
      DEFAULT_EVENT_DAYS
    );
  });

  it("keeps valid days", () => {
    const days = [{ date: "2026-11-20", openHour: 8, closeHour: 12 }];
    expect(normalizeEventDays(days)).toEqual(days);
  });
});

describe("buildEventSchedule", () => {
  it("reads the old openHourBrussels keys, so stored settings survive the move", () => {
    // Rows written before the event moved to Turkey still carry the old keys.
    // Rejecting them would fall back to the built-in hours and silently reopen
    // the rooms at times nobody chose.
    expect(
      normalizeEventDays([{ date: "2026-11-17", openHourBrussels: 10, closeHourBrussels: 16 }])
    ).toEqual([{ date: "2026-11-17", openHour: 10, closeHour: 16 }]);
  });

  it("prefers the new keys when a row carries both", () => {
    expect(
      normalizeEventDays([
        { date: "2026-11-17", openHour: 8, closeHour: 12, openHourBrussels: 10, closeHourBrussels: 16 },
      ])
    ).toEqual([{ date: "2026-11-17", openHour: 8, closeHour: 12 }]);
  });

  it("materialises atomic slot marks within the local window in UTC", () => {
    const [day] = buildEventSchedule([{ date: "2026-11-17", openHour: 14, closeHour: 15 }]);
    // 14:00-15:00 Istanbul (UTC+3) -> 11:00-12:00 UTC, at 15-min marks (close exclusive).
    const expectedCount = 60 / SLOT_GRANULARITY_MINUTES;
    expect(day.openSlotStartsUtc).toHaveLength(expectedCount);
    expect(day.openSlotStartsUtc[0].toISOString()).toBe("2026-11-17T11:00:00.000Z");
    expect(day.openSlotStartsUtc.at(-1)?.toISOString()).toBe("2026-11-17T11:45:00.000Z");
  });

  it("reflects custom opening hours (extending the window adds marks)", () => {
    const schedule = buildEventSchedule([{ date: "2026-11-19", openHour: 9, closeHour: 18 }]);
    const openMs = buildOpenSlotMs(schedule);
    // 17:00 Istanbul = 14:00 UTC is now open, which the default 9-11 window excluded.
    expect(openMs.has(new Date("2026-11-19T14:00:00.000Z").getTime())).toBe(true);
  });
});
