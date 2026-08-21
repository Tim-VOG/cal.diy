import { describe, expect, it } from "vitest";
import { brusselsDayBounds, brusselsToday, shiftDay } from "./deskDay";

describe("brusselsDayBounds", () => {
  it("covers a winter day, when Brussels is UTC+1", () => {
    // The event itself: 17 November 2026, CET.
    const { fromUtc, toUtc } = brusselsDayBounds("2026-11-17");
    expect(fromUtc.toISOString()).toBe("2026-11-16T23:00:00.000Z");
    expect(toUtc.toISOString()).toBe("2026-11-17T23:00:00.000Z");
  });

  it("covers a summer day, when Brussels is UTC+2", () => {
    // A rehearsal in August must not silently shift by an hour.
    const { fromUtc, toUtc } = brusselsDayBounds("2026-08-21");
    expect(fromUtc.toISOString()).toBe("2026-08-20T22:00:00.000Z");
    expect(toUtc.toISOString()).toBe("2026-08-21T22:00:00.000Z");
  });

  it("handles the day the clocks go back — 25 hours long", () => {
    // 25 October 2026: 03:00 CEST becomes 02:00 CET.
    const { fromUtc, toUtc } = brusselsDayBounds("2026-10-25");
    expect(fromUtc.toISOString()).toBe("2026-10-24T22:00:00.000Z");
    expect(toUtc.toISOString()).toBe("2026-10-25T23:00:00.000Z");
    expect((toUtc.getTime() - fromUtc.getTime()) / 3600000).toBe(25);
  });

  it("handles the day the clocks go forward — 23 hours long", () => {
    // 29 March 2026: 02:00 CET becomes 03:00 CEST.
    const { fromUtc, toUtc } = brusselsDayBounds("2026-03-29");
    expect(fromUtc.toISOString()).toBe("2026-03-28T23:00:00.000Z");
    expect(toUtc.toISOString()).toBe("2026-03-29T22:00:00.000Z");
    expect((toUtc.getTime() - fromUtc.getTime()) / 3600000).toBe(23);
  });

  it("leaves no gap between one day and the next", () => {
    // A booking must never fall between two days at the desk.
    for (const date of ["2026-11-17", "2026-10-25", "2026-03-29"]) {
      expect(brusselsDayBounds(date).toUtc.toISOString()).toBe(
        brusselsDayBounds(shiftDay(date, 1)).fromUtc.toISOString()
      );
    }
  });
});

describe("brusselsToday", () => {
  it("uses the Brussels day, not the server's", () => {
    // 23:30 UTC on the 16th is already the 17th in Brussels.
    expect(brusselsToday(new Date("2026-11-16T23:30:00.000Z"))).toBe("2026-11-17");
  });

  it("does not roll over early", () => {
    expect(brusselsToday(new Date("2026-11-16T22:30:00.000Z"))).toBe("2026-11-16");
  });
});

describe("shiftDay", () => {
  it("moves across month and year ends", () => {
    expect(shiftDay("2026-11-17", 1)).toBe("2026-11-18");
    expect(shiftDay("2026-11-01", -1)).toBe("2026-10-31");
    expect(shiftDay("2026-12-31", 1)).toBe("2027-01-01");
  });

  it("crosses a DST boundary without losing a day", () => {
    expect(shiftDay("2026-10-24", 1)).toBe("2026-10-25");
    expect(shiftDay("2026-10-25", 1)).toBe("2026-10-26");
  });
});
