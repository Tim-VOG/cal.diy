/**
 * The one visual language every NE26 mail is written in.
 *
 * They had drifted into three: the invoice arrived as a designed document, the
 * hold notices as bare paragraphs, and everything the sales desk received as a
 * wall of monospace inside a <pre>. The desk's mails are the ones read fastest,
 * under the most pressure, and they were the ugliest of the three.
 *
 * Deliberately plain HTML — tables, inline styles, no flex, no grid, no classes.
 * Outlook renders a good part of this estate, and it is 1999 in there.
 *
 * Pure on purpose: no nodemailer, no environment. The notification builders are
 * pure modules and are unit-tested as such; the layout has to be usable from
 * them without dragging a mail transport into the test.
 */

const INK = "#000643";
const MUTED = "#777";
const SOFT = "#555";
const RULE = "#e5e7eb";

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Wrap a message body. Keeps the measure readable on a desktop client and lets
 * a phone use the full width.
 */
export function emailShell(bodyHtml: string): string {
  return `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;font-size:15px;line-height:1.55;color:#111;max-width:560px">${bodyHtml}</div>`;
}

/** The bordered block the invoice uses for what was bought. */
export function card(innerHtml: string): string {
  return `<div style="border:1px solid ${RULE};border-radius:10px;padding:14px 16px;margin:16px 0">${innerHtml}</div>`;
}

export interface EmailRoomLine {
  roomName: string;
  /** "Tue, 17 Nov 2026, 09:00-10:00 TRT" */
  slotLabel: string;
  durationMinutes: number;
  amountLabel?: string;
  addOns: { name: string; quantity: number; lineLabel: string }[];
}

/** One room, its slot and its add-ons — the shape the invoice mail established. */
export function roomBlock(room: EmailRoomLine): string {
  const addOns = room.addOns
    .map(
      (a) =>
        `<tr><td style="padding:2px 0 2px 16px;color:${SOFT}">+ ${escapeHtml(a.name)} &times; ${a.quantity}</td><td style="padding:2px 0;text-align:right;color:${SOFT};white-space:nowrap">${escapeHtml(a.lineLabel)}</td></tr>`
    )
    .join("");
  const amount = room.amountLabel
    ? `<td style="padding:2px 0;text-align:right;font-weight:600;color:${INK};white-space:nowrap">${escapeHtml(room.amountLabel)}</td>`
    : "<td></td>";
  return `<table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="border-collapse:collapse;margin:0 0 14px"><tr><td style="padding:2px 0;font-weight:600;color:${INK}">${escapeHtml(room.roomName)} &mdash; ${room.durationMinutes / 60}h</td>${amount}</tr><tr><td colspan="2" style="padding:0 0 4px;color:${MUTED};font-size:13px">${escapeHtml(room.slotLabel)}</td></tr>${addOns}</table>`;
}

/** A label/value list — who bought it, what it came to, which invoice. */
export function factRows(facts: { label: string; value: string; strong?: boolean }[]): string {
  const rows = facts
    .map(({ label, value, strong }) => {
      const weight = strong ? `font-weight:700;color:${INK}` : `color:${SOFT}`;
      return `<tr><td style="padding:3px 12px 3px 0;color:${MUTED};font-size:13px;white-space:nowrap">${escapeHtml(label)}</td><td style="padding:3px 0;${weight}">${escapeHtml(value)}</td></tr>`;
    })
    .join("");
  return `<table role="presentation" cellpadding="0" cellspacing="0" style="border-collapse:collapse">${rows}</table>`;
}

/** A total, separated from what is above it. */
export function totalRow(label: string, value: string): string {
  return `<table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="border-collapse:collapse;border-top:1px solid ${RULE}"><tr><td style="padding:8px 0 0;font-weight:700;color:${INK}">${escapeHtml(label)}</td><td style="padding:8px 0 0;text-align:right;font-weight:700;color:${INK};white-space:nowrap">${escapeHtml(value)}</td></tr></table>`;
}

/** The links a reader acts on, as text rather than buttons: these go to inboxes. */
export function linkList(links: { label: string; href: string }[]): string {
  const items = links
    .filter((l) => l.href)
    .map(
      (l) =>
        `<div style="margin:4px 0"><a href="${escapeHtml(l.href)}" style="color:${INK}">${escapeHtml(l.label)}</a></div>`
    )
    .join("");
  return items ? `<div style="margin:16px 0 0">${items}</div>` : "";
}

/** The closing line every message ends on. */
export function signOff(extra?: string): string {
  const above = extra ? `${escapeHtml(extra)}<br/>` : "";
  return `<p style="color:${MUTED};font-size:13px;margin:18px 0 0">${above}NATO Edge 26 &mdash; Meeting Rooms</p>`;
}

/**
 * Render a plain-text body in the house style.
 *
 * The operational alerts — a double payment, a capture with no rooms — are
 * assembled as text at the point of failure and have no structure to lay out.
 * They were going out as monospace inside a <pre>; this at least gives them the
 * same typeface and turns the dashboard links into links, which is the only
 * thing the reader does with them.
 */
export function textToHtml(body: string): string {
  const url = /(https?:\/\/[^\s<]+)/g;
  const inline = (line: string) =>
    line
      .split(url)
      .map((part, i) =>
        i % 2 === 1
          ? `<a href="${escapeHtml(part)}" style="color:${INK}">${escapeHtml(part)}</a>`
          : escapeHtml(part)
      )
      .join("");
  return body
    .split(/\n{2,}/)
    .map((block) => block.split("\n").map(inline).join("<br/>"))
    .filter(Boolean)
    .map((block) => `<p style="margin:0 0 14px">${block}</p>`)
    .join("");
}

/** A room named with its slot underneath, for mails that carry no amounts. */
export function roomHeading(roomName: string, slotLabel: string): string {
  return `<div style="font-weight:600;color:${INK}">${escapeHtml(roomName)}</div><div style="color:${MUTED};font-size:13px;margin:2px 0 0">${escapeHtml(slotLabel)}</div>`;
}

/**
 * The one action a mail wants taken, as a bordered block rather than a styled
 * <a>: Outlook drops background colours on links often enough that a buyer with
 * 20 minutes left on a hold would see nothing to click.
 */
export function button(label: string, href: string): string {
  return `<table role="presentation" cellpadding="0" cellspacing="0" style="border-collapse:separate;margin:18px 0"><tr><td style="background:${INK};border-radius:8px"><a href="${escapeHtml(href)}" style="display:inline-block;padding:11px 20px;color:#fff;text-decoration:none;font-weight:600">${escapeHtml(label)}</a></td></tr></table>`;
}
