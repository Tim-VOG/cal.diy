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

describe("a room whose door says something else", () => {
  const ics = buildBookingIcs({
    uid: "abc-124",
    roomName: "Meeting 3",
    soldName: "Large Room 1",
    startUtc: new Date("2026-11-17T13:00:00.000Z"),
    endUtc: new Date("2026-11-17T14:00:00.000Z"),
    now: new Date("2026-06-05T10:00:00.000Z"),
  });

  it("puts the door name in the title and the location", () => {
    // This is the entry that pops up on a phone at 09:55; it has to say the
    // thing written on the door, not the thing written on the invoice.
    expect(ics).toContain("SUMMARY:Meeting 3 - NATO Edge 26");
    expect(ics).toContain("LOCATION:Meeting 3\\, Fuar Izmir\\, Izmir\\, Turkiye");
  });

  it("keeps the name it was sold under in the description", () => {
    expect(ics).toContain("Meeting 3 (Large Room 1)");
  });
});
