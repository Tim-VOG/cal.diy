/**
 * The payment page for a room held at the welcome desk, sent to the exhibitor.
 *
 * The counter sells through Stripe and nothing else, so a card refused at the
 * desk used to end the sale: the hostess had no fallback, and the room sat held
 * by a payment nobody could reach. This is the fallback — the same link, in the
 * exhibitor's inbox, so they can pay from their own phone or hand it to whoever
 * holds the company card, while the hold keeps the room off sale.
 *
 * Deliberately not a way to mark anything paid. The money still arrives through
 * Stripe or not at all.
 */

import { button, emailShell, escapeHtml, signOff } from "./emailLayout";

export function buildPaymentLinkEmail(input: {
  bookerName: string;
  roomLabel: string;
  checkoutUrl: string;
}): { subject: string; text: string; html: string } {
  const subject = `Finish paying for ${input.roomLabel} — NATO Edge 26`;

  const text = [
    `Hi ${input.bookerName},`,
    "",
    `${input.roomLabel} is being held for you at NATO Edge 26, and the payment has not gone through yet. The room is not yours until it does, and the hold frees itself if it does not.`,
    "",
    "Pay here:",
    input.checkoutUrl,
    "",
    "NATO Edge 26 — Meeting Rooms",
  ].join("\n");

  const html = emailShell(
    `<p style="margin:0 0 14px">Hi ${escapeHtml(input.bookerName)},</p>` +
      `<p style="margin:0 0 14px"><strong>${escapeHtml(
        input.roomLabel
      )}</strong> is being held for you at NATO Edge 26, and the payment has not gone through yet. The room is not yours until it does, and the hold frees itself if it does not.</p>` +
      button("Finish the payment", input.checkoutUrl) +
      signOff("17–19 November 2026 · Fuar İzmir, Türkiye · all times in TRT")
  );

  return { subject, text, html };
}

export async function sendPaymentLinkEmail(input: {
  to: string;
  bookerName: string;
  roomLabel: string;
  checkoutUrl: string;
}): Promise<void> {
  const { sendRoomsEmail } = await import("./mailer");
  const mail = buildPaymentLinkEmail(input);
  await sendRoomsEmail({ to: input.to, ...mail });
}
