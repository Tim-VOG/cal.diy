import { describe, expect, it } from "vitest";
import { buildBookingIcs } from "./ics";

describe("buildBookingIcs", () => {
  const ics = buildBookingIcs({
    uid: "abc-123",
    roomName: "Suite 1",
    startUtc: new Date("2026-11-17T13:00:00.000Z"),
    endUtc: new Date("2026-11-17T14:00:00.000Z"),
    now: new Date("2026-06-05T10:00:00.000Z"),
  });

  it("wraps a single VEVENT in a VCALENDAR with CRLF line breaks", () => {
    expect(ics.startsWith("BEGIN:VCALENDAR\r\n")).toBe(true);
    expect(ics.includes("BEGIN:VEVENT")).toBe(true);
    expect(ics.trimEnd().endsWith("END:VCALENDAR")).toBe(true);
  });

  it("formats start/end/stamp as iCalendar UTC", () => {
    expect(ics).toContain("DTSTART:20261117T130000Z");
    expect(ics).toContain("DTEND:20261117T140000Z");
    expect(ics).toContain("DTSTAMP:20260605T100000Z");
    expect(ics).toContain("UID:abc-123@rooms.vo-eu.be");
  });

  it("includes the room in the summary", () => {
    expect(ics).toContain("SUMMARY:Suite 1 - NATO Edge 26");
  });
});
