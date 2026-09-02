import process from "node:process";
import { ErrorCode } from "@calcom/lib/errorCodes";
import { ErrorWithCode } from "@calcom/lib/errors";
import nodemailer from "nodemailer";

/** One room as it appears in the confirmation, with what was ordered for it. */
export interface InvoiceEmailRoom {
  roomName: string;
  slotLabel: string;
  durationMinutes: number;
  amountLabel: string;
  addOns: { name: string; quantity: number; lineLabel: string }[];
}

export interface InvoiceEmailInput {
  to: string;
  bookerName: string;
  invoiceNumber: string;
  /** Subject line only — the body lists every room in full. */
  roomName: string;
  /**
   * Everything bought, room by room. An exhibitor who books three rooms was
   * told "Suite 1 + 2 more" and had to open the PDF to find out what the other
   * two were, or whether the catering they ordered had gone through.
   */
  rooms?: InvoiceEmailRoom[];
  amountLabel: string;
  pdf: Uint8Array;
  /** "invoice" (default) sends a confirmation; "credit_note" sends a refund notice. */
  documentKind?: "invoice" | "credit_note";
  /** Optional calendar invite (.ics) to attach, e.g. for booking confirmations. */
  ics?: string;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c] ?? c);
}

/**
 * Notify the NE26 team about something that happened, or that only a human can
 * settle: a sale to announce, a Stripe capture with no booking to attach it to,
 * a partial refund that needs manual paperwork.
 *
 * Recipients come from the admin settings (a comma-separated list), so sales can
 * be added without a redeploy. Honours NE26_EMAIL_REDIRECT_TO like every other
 * message, so test-phase notifications don't reach the team.
 */
export async function sendTeamEmail(input: {
  to: string[];
  subject: string;
  body: string;
}): Promise<void> {
  const recipients = input.to.map((a) => a.trim()).filter(Boolean);
  if (!recipients.length) return;

  const host = process.env.EMAIL_SERVER_HOST;
  const port = Number(process.env.EMAIL_SERVER_PORT);
  const user = process.env.EMAIL_SERVER_USER;
  const pass = process.env.EMAIL_SERVER_PASSWORD;
  const from = process.env.EMAIL_FROM;
  const fromName = process.env.EMAIL_FROM_NAME ?? "NATO Edge 26";
  if (!host || !port || !from) {
    throw new ErrorWithCode(
      ErrorCode.InternalServerError,
      "SMTP is not configured (EMAIL_SERVER_* / EMAIL_FROM)"
    );
  }

  const transport = nodemailer.createTransport({
    host,
    port,
    secure: port === 465,
    requireTLS: port === 587,
    auth: user && pass ? { user, pass } : undefined,
  });

  await transport.sendMail({
    from: `${fromName} <${from}>`,
    to: process.env.NE26_EMAIL_REDIRECT_TO || recipients.join(", "),
    subject: `[NE26 Rooms] ${input.subject}`,
    text: input.body,
    html: `<pre style="font-family:ui-monospace,monospace;font-size:13px">${escapeHtml(input.body)}</pre>`,
  });
}

/** Send the booking confirmation + invoice PDF over the configured SMTP server. */
/**
 * The rooms are held, but only for a while — say until when.
 *
 * Sent twice for one order: once when the hold is taken, and once when a
 * quarter of an hour is left. A buyer who leaves the payment page to fetch a
 * purchase order has no other way of knowing there is a clock, and the first
 * they learned of it was the room being gone.
 */
export async function sendHoldReminderEmail(input: {
  to: string;
  bookerName: string;
  roomName: string;
  slotLabel: string;
  /** Event-local wall-clock time the hold lapses, e.g. "14:35". */
  expiresAtLabel: string;
  minutesLeft: number;
  kind: "created" | "expiring";
  payUrl: string;
}): Promise<void> {
  const host = process.env.EMAIL_SERVER_HOST;
  const port = Number(process.env.EMAIL_SERVER_PORT);
  const user = process.env.EMAIL_SERVER_USER;
  const pass = process.env.EMAIL_SERVER_PASSWORD;
  const from = process.env.EMAIL_FROM;
  const fromName = process.env.EMAIL_FROM_NAME ?? "NATO Edge 26";
  if (!host || !port || !from) {
    throw new ErrorWithCode(
      ErrorCode.InternalServerError,
      "SMTP is not configured (EMAIL_SERVER_* / EMAIL_FROM)"
    );
  }
  const transport = nodemailer.createTransport({
    host,
    port,
    secure: port === 465,
    requireTLS: port === 587,
    auth: user && pass ? { user, pass } : undefined,
  });

  const name = escapeHtml(input.bookerName);
  const room = escapeHtml(input.roomName);
  const slot = escapeHtml(input.slotLabel);
  const until = escapeHtml(input.expiresAtLabel);
  const url = escapeHtml(input.payUrl);
  const isExpiring = input.kind === "expiring";

  const subject = isExpiring
    ? `${input.minutesLeft} minutes left to pay for ${input.roomName}`
    : `We are holding ${input.roomName} for you until ${input.expiresAtLabel}`;
  const opening = isExpiring
    ? `Your hold on ${input.roomName} (${input.slotLabel}) lapses at ${input.expiresAtLabel} — about ${input.minutesLeft} minutes from now. After that the room goes back on sale and anyone can take it.`
    : `We are holding ${input.roomName} (${input.slotLabel}) for you until ${input.expiresAtLabel}. Nothing has been charged yet, and the room is not booked until the payment goes through.`;

  const text = `Hi ${input.bookerName},\n\n${opening}\n\nFinish the payment here:\n${input.payUrl}\n\nNATO Edge 26 — Meeting Rooms`;
  const htmlOpening = isExpiring
    ? `Your hold on <strong>${room}</strong> (${slot}) lapses at <strong>${until}</strong> — about ${input.minutesLeft} minutes from now. After that the room goes back on sale and anyone can take it.`
    : `We are holding <strong>${room}</strong> (${slot}) for you until <strong>${until}</strong>. Nothing has been charged yet, and the room is not booked until the payment goes through.`;
  const html = `<p>Hi ${name},</p><p>${htmlOpening}</p><p><a href="${url}">Finish the payment here</a>.</p><p>NATO Edge 26 — Meeting Rooms</p>`;

  await transport.sendMail({
    from: `${fromName} <${from}>`,
    // NE26 test mode: redirect to a single inbox while testing (env-gated).
    to: process.env.NE26_EMAIL_REDIRECT_TO || input.to,
    subject,
    text,
    html,
  });
}

/**
 * Tell the buyer their hold is gone.
 *
 * A declined card or an abandoned checkout released the rooms in silence: the
 * exhibitor believed they had booked, and only found out at the event. This is
 * deliberately not an apology — it says what happened, that nothing was
 * charged, and where to try again.
 */
export async function sendHoldReleasedEmail(input: {
  to: string;
  bookerName: string;
  roomName: string;
  slotLabel: string;
  reason: "payment_failed" | "session_expired";
  bookAgainUrl: string;
}): Promise<void> {
  const host = process.env.EMAIL_SERVER_HOST;
  const port = Number(process.env.EMAIL_SERVER_PORT);
  const user = process.env.EMAIL_SERVER_USER;
  const pass = process.env.EMAIL_SERVER_PASSWORD;
  const from = process.env.EMAIL_FROM;
  const fromName = process.env.EMAIL_FROM_NAME ?? "NATO Edge 26";
  if (!host || !port || !from) {
    throw new ErrorWithCode(
      ErrorCode.InternalServerError,
      "SMTP is not configured (EMAIL_SERVER_* / EMAIL_FROM)"
    );
  }
  const transport = nodemailer.createTransport({
    host,
    port,
    secure: port === 465,
    requireTLS: port === 587,
    auth: user && pass ? { user, pass } : undefined,
  });

  const name = escapeHtml(input.bookerName);
  const room = escapeHtml(input.roomName);
  const slot = escapeHtml(input.slotLabel);
  const url = escapeHtml(input.bookAgainUrl);
  const what =
    input.reason === "payment_failed"
      ? "your payment could not be completed"
      : "the payment page expired before it was completed";

  const subject = `Your NATO Edge 26 room was not booked — ${input.roomName}`;
  const text = `Hi ${input.bookerName},\n\nWe held ${input.roomName} (${input.slotLabel}) for you, but ${what}. Nothing was charged, and the room is back on sale.\n\nIf you still want it, book again here — it is first come, first served:\n${input.bookAgainUrl}\n\nNATO Edge 26 — Meeting Rooms`;
  const html = `<p>Hi ${name},</p><p>We held <strong>${room}</strong> (${slot}) for you, but ${what}. <strong>Nothing was charged</strong>, and the room is back on sale.</p><p>If you still want it, <a href="${url}">book again here</a> — it is first come, first served.</p><p>NATO Edge 26 — Meeting Rooms</p>`;

  await transport.sendMail({
    from: `${fromName} <${from}>`,
    // NE26 test mode: redirect to a single inbox while testing (env-gated).
    to: process.env.NE26_EMAIL_REDIRECT_TO || input.to,
    subject,
    text,
    html,
  });
}

export async function sendInvoiceEmail(input: InvoiceEmailInput): Promise<void> {
  const host = process.env.EMAIL_SERVER_HOST;
  const port = Number(process.env.EMAIL_SERVER_PORT);
  const user = process.env.EMAIL_SERVER_USER;
  const pass = process.env.EMAIL_SERVER_PASSWORD;
  const from = process.env.EMAIL_FROM;
  const fromName = process.env.EMAIL_FROM_NAME ?? "NATO Edge 26";
  if (!host || !port || !from) {
    throw new ErrorWithCode(
      ErrorCode.InternalServerError,
      "SMTP is not configured (EMAIL_SERVER_* / EMAIL_FROM)"
    );
  }

  const transport = nodemailer.createTransport({
    host,
    port,
    secure: port === 465,
    requireTLS: port === 587,
    auth: user && pass ? { user, pass } : undefined,
  });

  const name = escapeHtml(input.bookerName);
  const room = escapeHtml(input.roomName);
  const amount = escapeHtml(input.amountLabel);
  const isCredit = input.documentKind === "credit_note";
  const icsText = input.ics
    ? " A calendar invite (.ics) is attached so you can add the booking to your calendar."
    : "";
  const icsHtml = input.ics
    ? " A calendar invite (<strong>.ics</strong>) is attached so you can add the booking to your calendar."
    : "";

  const subject = isCredit
    ? `Your NATO Edge 26 refund — credit note ${input.invoiceNumber}`
    : `Your NATO Edge 26 booking — invoice ${input.invoiceNumber}`;
  // What was actually bought, room by room, in the body — not a count.
  const rooms = input.rooms ?? [];
  const roomsText = rooms
    .map((r) => {
      const lines = [
        `${r.roomName} — ${r.durationMinutes / 60}h`,
        `  ${r.slotLabel}`,
        ...r.addOns.map((a) => `  + ${a.name} x ${a.quantity} — ${a.lineLabel}`),
        `  ${r.amountLabel} excl. VAT`,
      ];
      return lines.join("\n");
    })
    .join("\n\n");
  const roomsHtml = rooms
    .map((r) => {
      const addOns = r.addOns
        .map(
          (a) =>
            `<tr><td style="padding:2px 0 2px 16px;color:#555">+ ${escapeHtml(a.name)} &times; ${a.quantity}</td><td style="padding:2px 0;text-align:right;color:#555;white-space:nowrap">${escapeHtml(a.lineLabel)}</td></tr>`
        )
        .join("");
      return `<table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="border-collapse:collapse;margin:0 0 14px"><tr><td style="padding:2px 0;font-weight:600;color:#000643">${escapeHtml(r.roomName)} — ${r.durationMinutes / 60}h</td><td style="padding:2px 0;text-align:right;font-weight:600;color:#000643;white-space:nowrap">${escapeHtml(r.amountLabel)}</td></tr><tr><td colspan="2" style="padding:0 0 4px;color:#777;font-size:13px">${escapeHtml(r.slotLabel)}</td></tr>${addOns}</table>`;
    })
    .join("");

  const textBody = isCredit
    ? `Hi ${input.bookerName},\n\nYour booking at NATO Edge 26 has been cancelled and refunded.\nA refund of ${input.amountLabel} has been issued.\n\n${roomsText}\n\nCredit note ${input.invoiceNumber} is attached.\n\nNATO Edge 26 — Meeting Rooms`
    : `Hi ${input.bookerName},\n\nThank you for booking with NATO Edge 26. Your payment of ${input.amountLabel} has been received.\n\n${roomsText}\n\nInvoice ${input.invoiceNumber} is attached.${icsText}\n\n17-19 November 2026 — Fuar Izmir, Turkiye\nAll times are shown in TRT.\n\nNATO Edge 26 — Meeting Rooms`;

  const summary = roomsHtml
    ? `<div style="border:1px solid #e5e7eb;border-radius:10px;padding:14px 16px;margin:16px 0">${roomsHtml}<table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="border-collapse:collapse;border-top:1px solid #e5e7eb"><tr><td style="padding:8px 0 0;font-weight:700;color:#000643">Total paid</td><td style="padding:8px 0 0;text-align:right;font-weight:700;color:#000643;white-space:nowrap">${amount}</td></tr></table></div>`
    : "";

  const htmlBody = isCredit
    ? `<p>Hi ${name},</p><p>Your booking at NATO Edge 26 has been cancelled and refunded.</p>${summary}<p>A refund of <strong>${amount}</strong> has been issued. Credit note <strong>${input.invoiceNumber}</strong> is attached.</p><p style="color:#777;font-size:13px">NATO Edge 26 — Meeting Rooms</p>`
    : `<p>Hi ${name},</p><p>Thank you for booking with NATO Edge 26. Your payment has been received.</p>${summary}<p>Invoice <strong>${input.invoiceNumber}</strong> is attached.${icsHtml}</p><p style="color:#777;font-size:13px">17&ndash;19 November 2026 &middot; Fuar &#304;zmir, T&uuml;rkiye &middot; all times in TRT<br/>NATO Edge 26 &mdash; Meeting Rooms</p>`;

  await transport.sendMail({
    from: `${fromName} <${from}>`,
    // NE26 test mode: redirect to a single inbox while testing (env-gated).
    to: process.env.NE26_EMAIL_REDIRECT_TO || input.to,
    subject,
    text: textBody,
    html: htmlBody,
    attachments: [
      {
        filename: `${input.invoiceNumber}.pdf`,
        content: Buffer.from(input.pdf),
        contentType: "application/pdf",
      },
      ...(input.ics
        ? [
            {
              filename: "booking.ics",
              content: input.ics,
              contentType: "text/calendar; method=PUBLISH; charset=UTF-8",
            },
          ]
        : []),
    ],
  });
}
