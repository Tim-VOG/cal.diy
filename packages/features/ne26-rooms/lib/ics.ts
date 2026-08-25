/** Minimal RFC 5545 iCalendar (.ics) builder for a room booking. */

/** UTC instant → iCalendar basic UTC form: YYYYMMDDTHHMMSSZ. */
function toIcsUtc(d: Date): string {
  return d
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}Z$/, "Z");
}

function escapeIcs(s: string): string {
  return s.replace(/([,;\\])/g, "\\$1").replace(/\r?\n/g, "\\n");
}

export interface BookingIcsInput {
  uid: string;
  roomName: string;
  startUtc: Date;
  endUtc: Date;
  /** Stamp time; pass the current time. Defaults to `new Date()`. */
  now?: Date;
}

/**
 * Build a single-event VCALENDAR for a confirmed room booking, attachable to
 * the confirmation email so the booker can add the slot to their calendar.
 * Lines are CRLF-separated as required by RFC 5545.
 */
export function buildBookingIcs(input: BookingIcsInput): string {
  const stamp = toIcsUtc(input.now ?? new Date());
  return [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//VO Europe//NATO Edge 26 Rooms//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    `UID:${input.uid}@rooms.vo-eu.be`,
    `DTSTAMP:${stamp}`,
    `DTSTART:${toIcsUtc(input.startUtc)}`,
    `DTEND:${toIcsUtc(input.endUtc)}`,
    `SUMMARY:${escapeIcs(`${input.roomName} - NATO Edge 26`)}`,
    // The room, then the venue: this is what an attendee navigates to, so it
    // names the place rather than just the event.
    `LOCATION:${escapeIcs(`${input.roomName}, Fuar Izmir, Izmir, Turkiye`)}`,
    `DESCRIPTION:${escapeIcs(`Meeting room booking: ${input.roomName} at NATO Edge 26.`)}`,
    "END:VEVENT",
    "END:VCALENDAR",
  ].join("\r\n");
}
