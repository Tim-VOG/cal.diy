import process from "node:process";
import { ErrorCode } from "@calcom/lib/errorCodes";
import { ErrorWithCode } from "@calcom/lib/errors";
import nodemailer from "nodemailer";
import {
  button,
  card,
  emailShell,
  escapeHtml,
  factRows,
  roomBlock,
  roomHeading,
  signOff,
  textToHtml,
  totalRow,
} from "./emailLayout";

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

/**
 * The SMTP transport, built the same way for every message.
 *
 * It was copied into each sender, which is how the team mail ended up on its own
 * settings and, for a while, its own idea of what a mail from NE26 looks like.
 */
function transportOrThrow(): { transport: nodemailer.Transporter; from: string } {
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
  return {
    transport: nodemailer.createTransport({
      host,
      port,
      secure: port === 465,
      requireTLS: port === 587,
      auth: user && pass ? { user, pass } : undefined,
    }),
    from: `${fromName} <${from}>`,
  };
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
  /**
   * Kept in the loop without being asked to act — the technical address on a
   * sale, so it holds the full picture without the sales desk having to forward
   * anything.
   */
  cc?: string[];
  subject: string;
  body: string;
  /**
   * The laid-out version, when the caller has one. The operational alerts are
   * assembled as text where they are raised and have no structure to lay out;
   * they fall back to the plain body rendered in the same house style, which is
   * still a large improvement on the monospace block it used to be.
   */
  html?: string;
}): Promise<void> {
  const recipients = input.to.map((a) => a.trim()).filter(Boolean);
  if (!recipients.length) return;
  const copies = (input.cc ?? []).map((a) => a.trim()).filter(Boolean);

  const { transport, from } = transportOrThrow();

  // The staging redirect has to swallow the copies too. Sending "to" to a test
  // inbox while the real technical address still got a cc would be a redirect
  // that only half works, which is worse than none at all.
  const redirect = process.env.NE26_EMAIL_REDIRECT_TO;

  await transport.sendMail({
    from,
    to: redirect || recipients.join(", "),
    ...(redirect || !copies.length ? {} : { cc: copies.join(", ") }),
    subject: `[NE26 Rooms] ${input.subject}`,
    text: input.body,
    html: input.html ?? emailShell(textToHtml(input.body)),
  });
}

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
  const { transport, from } = transportOrThrow();

  const name = escapeHtml(input.bookerName);
  const room = escapeHtml(input.roomName);
  const isExpiring = input.kind === "expiring";

  // Both messages lead with the DURATION, which cannot be misread from any
  // timezone, and keep the wall-clock time as a labelled second reference. The
  // hold-taken mail used to carry the absolute time alone, so a buyer outside
  // Türkiye read a deadline an hour or two later than the one they had.
  const subject = isExpiring
    ? `${input.minutesLeft} minutes left to pay for ${input.roomName}`
    : `We are holding ${input.roomName} for you for the next ${input.minutesLeft} minutes`;
  const opening = isExpiring
    ? `Your hold on ${input.roomName} (${input.slotLabel}) lapses in about ${input.minutesLeft} minutes, at ${input.expiresAtLabel}. After that the room goes back on sale and anyone can take it.`
    : `We are holding ${input.roomName} (${input.slotLabel}) for you for the next ${input.minutesLeft} minutes, until ${input.expiresAtLabel}. Nothing has been charged yet, and the room is not booked until the payment goes through.`;

  const text = `Hi ${input.bookerName},\n\n${opening}\n\nFinish the payment here:\n${input.payUrl}\n\nNATO Edge 26 — Meeting Rooms`;

  const htmlOpening = isExpiring
    ? `Your hold on <strong>${room}</strong> lapses in about <strong>${input.minutesLeft} minutes</strong>. After that the room goes back on sale and anyone can take it.`
    : `We are holding <strong>${room}</strong> for you for the next <strong>${input.minutesLeft} minutes</strong>. Nothing has been charged yet, and the room is not booked until the payment goes through.`;

  const html = emailShell(
    `<p style="margin:0 0 14px">Hi ${name},</p><p style="margin:0 0 14px">${htmlOpening}</p>` +
      card(
        `${roomHeading(input.roomName, input.slotLabel)}<div style="margin:12px 0 0">${factRows([
          { label: "Held until", value: input.expiresAtLabel, strong: true },
        ])}</div>`
      ) +
      button("Finish the payment", input.payUrl) +
      signOff("17–19 November 2026 · Fuar İzmir, Türkiye · all times in TRT")
  );

  await transport.sendMail({
    from,
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
  const { transport, from } = transportOrThrow();

  const name = escapeHtml(input.bookerName);
  const room = escapeHtml(input.roomName);
  const what =
    input.reason === "payment_failed"
      ? "your payment could not be completed"
      : "the payment page expired before it was completed";

  const subject = `Your NATO Edge 26 room was not booked — ${input.roomName}`;
  const text = `Hi ${input.bookerName},\n\nWe held ${input.roomName} (${input.slotLabel}) for you, but ${what}. Nothing was charged, and the room is back on sale.\n\nIf you still want it, book again here — it is first come, first served:\n${input.bookAgainUrl}\n\nNATO Edge 26 — Meeting Rooms`;

  const html = emailShell(
    `<p style="margin:0 0 14px">Hi ${name},</p><p style="margin:0 0 14px">We held <strong>${room}</strong> for you, but ${what}. <strong>Nothing was charged</strong>, and the room is back on sale.</p>` +
      card(roomHeading(input.roomName, input.slotLabel)) +
      `<p style="margin:0 0 14px">If you still want it, book again — it is first come, first served.</p>` +
      button("Book again", input.bookAgainUrl) +
      signOff("17–19 November 2026 · Fuar İzmir, Türkiye · all times in TRT")
  );

  await transport.sendMail({
    from,
    // NE26 test mode: redirect to a single inbox while testing (env-gated).
    to: process.env.NE26_EMAIL_REDIRECT_TO || input.to,
    subject,
    text,
    html,
  });
}

/** Send the booking confirmation + invoice PDF over the configured SMTP server. */
export async function sendInvoiceEmail(input: InvoiceEmailInput): Promise<void> {
  const { transport, from } = transportOrThrow();

  const name = escapeHtml(input.bookerName);
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
  const roomsHtml = rooms.map(roomBlock).join("");

  const textBody = isCredit
    ? `Hi ${input.bookerName},\n\nYour booking at NATO Edge 26 has been cancelled and refunded.\nA refund of ${input.amountLabel} has been issued.\n\n${roomsText}\n\nCredit note ${input.invoiceNumber} is attached.\n\nNATO Edge 26 — Meeting Rooms`
    : `Hi ${input.bookerName},\n\nThank you for booking with NATO Edge 26. Your payment of ${input.amountLabel} has been received.\n\n${roomsText}\n\nInvoice ${input.invoiceNumber} is attached.${icsText}\n\n17-19 November 2026 — Fuar Izmir, Turkiye\nAll times are shown in TRT.\n\nNATO Edge 26 — Meeting Rooms`;

  const summary = roomsHtml
    ? card(roomsHtml + totalRow(isCredit ? "Total refunded" : "Total paid", input.amountLabel))
    : "";

  const htmlBody = emailShell(
    isCredit
      ? `<p style="margin:0 0 14px">Hi ${name},</p><p style="margin:0 0 14px">Your booking at NATO Edge 26 has been cancelled and refunded.</p>${summary}<p style="margin:0 0 14px">A refund of <strong>${amount}</strong> has been issued. Credit note <strong>${escapeHtml(input.invoiceNumber)}</strong> is attached.</p>${signOff()}`
      : `<p style="margin:0 0 14px">Hi ${name},</p><p style="margin:0 0 14px">Thank you for booking with NATO Edge 26. Your payment has been received.</p>${summary}<p style="margin:0 0 14px">Invoice <strong>${escapeHtml(input.invoiceNumber)}</strong> is attached.${icsHtml}</p>${signOff("17–19 November 2026 · Fuar İzmir, Türkiye · all times in TRT")}`
  );

  await transport.sendMail({
    from,
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
