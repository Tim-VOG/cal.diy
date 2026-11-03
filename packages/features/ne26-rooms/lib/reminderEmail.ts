/**
 * The mail an exhibitor gets shortly before the event: where to go.
 *
 * It exists for one reason. The rooms are sold as "Small Room 1" and the doors
 * at Fuar İzmir are signposted "Meeting 1" — and the numbering deliberately
 * does not line up, since Meeting 3 and 4 are the large rooms sitting between
 * the small ones. Somebody arriving with a confirmation that says one thing and
 * a door that says another assumes a mistake, and asks the hostess. This mail
 * puts the two names side by side before they travel, so the door is expected
 * rather than explained at the counter.
 *
 * So the whole message is built around the pairing: the door name is what the
 * reader needs on the day and leads; the name they bought is right under it,
 * because that is what their invoice says and what they will search for.
 *
 * Pure, like the other builders here: no transport, no environment, so it can
 * be unit-tested and rendered to a file for review without sending anything.
 */

import { card, emailShell, escapeHtml, linkList, signOff } from "./emailLayout";

const INK = "#000643";
const MUTED = "#777";
const RULE = "#e5e7eb";

export interface ReminderRoom {
  /** What the sign on the door says — "Meeting 1", or "Suite 1". */
  doorName: string;
  /** The name it was sold under, only when the door says something else. */
  soldName: string | null;
  /** "Tue 17 Nov, 10:00–11:00" — the day and time, event-local. */
  slotLabel: string;
  /** Catering already paid for, so nobody has to ask whether it is coming. */
  addOns: { name: string; quantity: number }[];
}

export interface ReminderInput {
  bookerName: string;
  rooms: readonly ReminderRoom[];
  /** Where "My bookings" lives, for the person who has lost the mail. */
  bookingsUrl: string;
  /** Who to write to. */
  contactEmail: string;
}

export function reminderSubject(rooms: readonly ReminderRoom[]): string {
  const [first] = rooms;
  if (!first) return "Your NATO Edge 26 meeting room";
  if (rooms.length === 1) {
    return first.soldName
      ? `Your NATO Edge 26 room is signposted ${first.doorName}`
      : `Where to find your NATO Edge 26 room — ${first.doorName}`;
  }
  return "Where to find your NATO Edge 26 meeting rooms";
}

function roomLines(rooms: readonly ReminderRoom[]): string[] {
  return rooms.map((r) => {
    const sold = r.soldName ? `\n  Booked as ${r.soldName}` : "";
    const extras = r.addOns.length
      ? `\n  Included: ${r.addOns.map((a) => `${a.name} x ${a.quantity}`).join(", ")}`
      : "";
    return `${r.doorName}\n  ${r.slotLabel}${sold}${extras}`;
  });
}

function roomCard(r: ReminderRoom): string {
  const sold = r.soldName
    ? `<div style="color:${MUTED};font-size:13px;margin:3px 0 0">Booked as ${escapeHtml(r.soldName)}</div>`
    : "";
  const extras = r.addOns.length
    ? `<div style="color:${MUTED};font-size:13px;margin:6px 0 0">Included: ${escapeHtml(
        r.addOns.map((a) => `${a.name} × ${a.quantity}`).join(", ")
      )}</div>`
    : "";
  // The door name at 19px: this is the one thing the reader has to carry with
  // them, and they will be reading it on a phone, walking.
  return `<div style="padding:12px 0;border-bottom:1px solid ${RULE}"><div style="font-weight:700;font-size:19px;color:${INK}">${escapeHtml(
    r.doorName
  )}</div><div style="color:#555;margin:2px 0 0">${escapeHtml(r.slotLabel)}</div>${sold}${extras}</div>`;
}

export function buildReminderEmail(input: ReminderInput): {
  subject: string;
  text: string;
  html: string;
} {
  const many = input.rooms.length > 1;

  const text = [
    `Hi ${input.bookerName},`,
    "",
    many
      ? "Here is a reminder of your bookings at NATO Edge 26."
      : "Here is a reminder of your booking at NATO Edge 26.",
    "",
    ...roomLines(input.rooms),
    "",
    `Your bookings: ${input.bookingsUrl}`,
    `Questions: ${input.contactEmail}`,
    "",
    "NATO Edge 26 — Meeting Rooms",
  ].join("\n");

  const html = emailShell(
    `<p style="margin:0 0 14px">Hi ${escapeHtml(input.bookerName)},</p>` +
      `<p style="margin:0 0 14px">Here is a reminder of your ${
        many ? "bookings" : "booking"
      } at NATO Edge 26.</p>` +
      card(input.rooms.map(roomCard).join("")) +
      linkList([
        { label: "Your bookings", href: input.bookingsUrl },
        { label: `Questions — ${input.contactEmail}`, href: `mailto:${input.contactEmail}` },
      ]) +
      signOff("17–19 November 2026 · Fuar İzmir, Türkiye")
  );

  return { subject: reminderSubject(input.rooms), text, html };
}
