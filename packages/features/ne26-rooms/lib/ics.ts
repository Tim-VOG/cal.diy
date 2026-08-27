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

export interface BookingIcsEvent {
  uid: string;
  roomName: string;
  startUtc: Date;
  endUtc: Date;
}

export interface BookingIcsInput extends BookingIcsEvent {
  /** Stamp time; pass the current time. Defaults to `new Date()`. */
  now?: Date;
}

function vevent(event: BookingIcsEvent, stamp: string): string[] {
  return [
    "BEGIN:VEVENT",
    `UID:${event.uid}@rooms.vo-eu.be`,
    `DTSTAMP:${stamp}`,
    `DTSTART:${toIcsUtc(event.startUtc)}`,
    `DTEND:${toIcsUtc(event.endUtc)}`,
    `SUMMARY:${escapeIcs(`${event.roomName} - NATO Edge 26`)}`,
    // The room, then the venue: this is what an attendee navigates to, so it
    // names the place rather than just the event.
    `LOCATION:${escapeIcs(`${event.roomName}, Fuar Izmir, Izmir, Turkiye`)}`,
    `DESCRIPTION:${escapeIcs(`Meeting room booking: ${event.roomName} at NATO Edge 26.`)}`,
    "END:VEVENT",
  ];
}

/**
 * Build a VCALENDAR for the rooms in one order, attachable to the confirmation
 * email so the booker can add every slot to their calendar in one go.
 *
 * One file with several VEVENTs rather than several attachments: an exhibitor
 * who booked three rooms should press "add to calendar" once. Lines are
 * CRLF-separated as required by RFC 5545.
 */
export function buildOrderIcs(events: readonly BookingIcsEvent[], now: Date = new Date()): string {
  const stamp = toIcsUtc(now);
  return [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//VO Europe//NATO Edge 26 Rooms//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    ...events.flatMap((event) => vevent(event, stamp)),
    "END:VCALENDAR",
  ].join("\r\n");
}

/** Single-room convenience wrapper. */
export function buildBookingIcs(input: BookingIcsInput): string {
  return buildOrderIcs([input], input.now ?? new Date());
}
