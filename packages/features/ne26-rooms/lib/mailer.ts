import nodemailer from "nodemailer";

import { ErrorCode } from "@calcom/lib/errorCodes";
import { ErrorWithCode } from "@calcom/lib/errors";

export interface InvoiceEmailInput {
  to: string;
  bookerName: string;
  invoiceNumber: string;
  roomName: string;
  amountLabel: string;
  pdf: Uint8Array;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c] ?? c);
}

/** Send the booking confirmation + invoice PDF over the configured SMTP server. */
export async function sendInvoiceEmail(input: InvoiceEmailInput): Promise<void> {
  const host = process.env.EMAIL_SERVER_HOST;
  const port = Number(process.env.EMAIL_SERVER_PORT);
  const user = process.env.EMAIL_SERVER_USER;
  const pass = process.env.EMAIL_SERVER_PASSWORD;
  const from = process.env.EMAIL_FROM;
  const fromName = process.env.EMAIL_FROM_NAME ?? "NATO Edge 26";
  if (!host || !port || !from) {
    throw new ErrorWithCode(ErrorCode.InternalServerError, "SMTP is not configured (EMAIL_SERVER_* / EMAIL_FROM)");
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
  await transport.sendMail({
    from: `${fromName} <${from}>`,
    to: input.to,
    subject: `Your NATO Edge 26 booking — invoice ${input.invoiceNumber}`,
    text: `Hi ${input.bookerName},\n\nThank you for booking ${input.roomName} at NATO Edge 26.\nYour payment of ${input.amountLabel} has been received.\n\nInvoice ${input.invoiceNumber} is attached.\n\nNATO Edge 26 — Meeting Rooms`,
    html: `<p>Hi ${name},</p><p>Thank you for booking <strong>${room}</strong> at NATO Edge 26.</p><p>Your payment of <strong>${escapeHtml(input.amountLabel)}</strong> has been received. Invoice <strong>${input.invoiceNumber}</strong> is attached.</p><p>NATO Edge 26 — Meeting Rooms</p>`,
    attachments: [{ filename: `${input.invoiceNumber}.pdf`, content: Buffer.from(input.pdf), contentType: "application/pdf" }],
  });
}
