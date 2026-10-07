import logger from "@calcom/lib/logger";
import { type NotificationAudience, routeNotification } from "./notificationRouting";

const log = logger.getSubLogger({ prefix: ["[ne26-team-mail]"] });

/**
 * Email the NE26 team, wherever the news comes from.
 *
 * It lived inside the Stripe webhook, which was fine while Stripe was the only
 * thing that moved money. An exhibitor cancelling a room from their own page
 * moves it too, and the sales desk has to hear about that one just as much: a
 * room coming back on sale without a word is exactly the surprise that ends in
 * a double promise.
 *
 * Never throws. A notification that cannot be sent must not fail the thing it
 * was reporting — the refund has already happened.
 */
export async function notifyTeam(
  audience: NotificationAudience,
  subject: string,
  body: string,
  html?: string
): Promise<void> {
  try {
    const { getInvoiceSettingsRepository } = await import("../di/InvoiceSettingsRepository.container");
    const settings = await getInvoiceSettingsRepository().get();
    const envelope = routeNotification(audience, settings, process.env.EMAIL_FROM);
    if (!envelope.to.length) {
      log.error(`Team notification has nowhere to go: ${subject} — ${body}`);
      return;
    }
    const { sendTeamEmail } = await import("./mailer");
    await sendTeamEmail({ to: envelope.to, cc: envelope.cc, subject, body, html });
  } catch (e) {
    log.error(`Could not send the team notification "${subject}"`, e);
  }
}
