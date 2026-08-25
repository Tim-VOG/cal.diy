import { describe, expect, it } from "vitest";
import { eventDayBounds, eventToday, shiftDay } from "./deskDay";

// The event runs in Turkey. Europe/Istanbul is a flat UTC+3 with no DST, so
// every day is exactly 24 hours long — which is precisely why the offset is
// still read from the tz database rather than assumed: the app has already
// moved timezone once, and a wrong constant stays invisible until a booking
// lands on the wrong day.

describe("eventDayBounds", () => {
  it("covers an event day at UTC+3", () => {
    const { fromUtc, toUtc } = eventDayBounds("2026-11-17");
    expect(fromUtc.toISOString()).toBe("2026-11-16T21:00:00.000Z");
    expect(toUtc.toISOString()).toBe("2026-11-17T21:00:00.000Z");
  });

  it("uses the same offset in summer — Turkey does not change its clocks", () => {
    // Under Brussels this day was UTC+2 while the event days were UTC+1, so a
    // rehearsal behaved differently from the event itself. Here they match.
    const { fromUtc, toUtc } = eventDayBounds("2026-08-21");
    expect(fromUtc.toISOString()).toBe("2026-08-20T21:00:00.000Z");
    expect(toUtc.toISOString()).toBe("2026-08-21T21:00:00.000Z");
  });

  it("gives every day exactly 24 hours, European DST switch days included", () => {
    for (const date of ["2026-03-29", "2026-10-25", "2026-11-17"]) {
      const { fromUtc, toUtc } = eventDayBounds(date);
      expect((toUtc.getTime() - fromUtc.getTime()) / 3600000).toBe(24);
    }
  });

  it("leaves no gap between one day and the next", () => {
    // A booking must never fall between two days at the desk.
    for (const date of ["2026-11-17", "2026-10-25", "2026-03-29"]) {
      expect(eventDayBounds(date).toUtc.toISOString()).toBe(
        eventDayBounds(shiftDay(date, 1)).fromUtc.toISOString()
      );
    }
  });
});

describe("eventToday", () => {
  it("uses the event's day, not the server's", () => {
    // 21:30 UTC on the 16th is already the 17th in Istanbul.
    expect(eventToday(new Date("2026-11-16T21:30:00.000Z"))).toBe("2026-11-17");
  });

  it("does not roll over early", () => {
    expect(eventToday(new Date("2026-11-16T20:30:00.000Z"))).toBe("2026-11-16");
  });
});

describe("shiftDay", () => {
  it("moves across month and year ends", () => {
    expect(shiftDay("2026-11-17", 1)).toBe("2026-11-18");
    expect(shiftDay("2026-11-01", -1)).toBe("2026-10-31");
    expect(shiftDay("2026-12-31", 1)).toBe("2027-01-01");
  });
});
