import process from "node:process";
import { ErrorCode } from "@calcom/lib/errorCodes";
import { ErrorWithCode } from "@calcom/lib/errors";
import nodemailer from "nodemailer";

export interface InvoiceEmailInput {
  to: string;
  bookerName: string;
  invoiceNumber: string;
  roomName: string;
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
  const textBody = isCredit
    ? `Hi ${input.bookerName},\n\nYour booking of ${input.roomName} at NATO Edge 26 has been cancelled and refunded.\nA refund of ${input.amountLabel} has been issued.\n\nCredit note ${input.invoiceNumber} is attached.\n\nNATO Edge 26 — Meeting Rooms`
    : `Hi ${input.bookerName},\n\nThank you for booking ${input.roomName} at NATO Edge 26.\nYour payment of ${input.amountLabel} has been received.\n\nInvoice ${input.invoiceNumber} is attached.${icsText}\n\nNATO Edge 26 — Meeting Rooms`;
  const htmlBody = isCredit
    ? `<p>Hi ${name},</p><p>Your booking of <strong>${room}</strong> at NATO Edge 26 has been cancelled and refunded.</p><p>A refund of <strong>${amount}</strong> has been issued. Credit note <strong>${input.invoiceNumber}</strong> is attached.</p><p>NATO Edge 26 — Meeting Rooms</p>`
    : `<p>Hi ${name},</p><p>Thank you for booking <strong>${room}</strong> at NATO Edge 26.</p><p>Your payment of <strong>${amount}</strong> has been received. Invoice <strong>${input.invoiceNumber}</strong> is attached.${icsHtml}</p><p>NATO Edge 26 — Meeting Rooms</p>`;

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
