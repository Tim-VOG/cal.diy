import { getNe26OrderRepository } from "@calcom/features/ne26-rooms/di/Ne26OrderRepository.container";
import { sendHoldReminderEmail } from "@calcom/features/ne26-rooms/lib/mailer";
import { remindExpiringHolds } from "@calcom/features/ne26-rooms/services/HoldReminderService";
import { WEBAPP_URL } from "@calcom/lib/constants";
import logger from "@calcom/lib/logger";
import { defaultResponderForAppDir } from "app/api/defaultResponderForAppDir";
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

const log = logger.getSubLogger({ prefix: ["[ne26-hold-reminders]"] });

/**
 * Warn buyers whose unpaid hold is about to lapse.
 *
 * Meant to run every few minutes. Safe to run more often, and safe to overlap:
 * each reminder is claimed in the database before it is sent, so a slow run
 * cannot make the next one mail the same buyer again.
 *
 * Authenticated with CRON_API_KEY like Cal's other cron routes — this sends mail
 * on our behalf, so it must not be open to the internet.
 */
async function postHandler(req: NextRequest): Promise<Response> {
  const apiKey = req.headers.get("authorization") || req.nextUrl.searchParams.get("apiKey");
  if (!process.env.CRON_API_KEY || process.env.CRON_API_KEY !== apiKey) {
    return NextResponse.json({ message: "Not authenticated" }, { status: 401 });
  }

  const orders = getNe26OrderRepository();
  const { sent } = await remindExpiringHolds(
    {
      findHoldsExpiringSoon: (from, before) => orders.findHoldsExpiringSoon(from, before),
      claimHoldReminder: (uid, at) => orders.claimHoldReminder(uid, at),
      sendReminder: sendHoldReminderEmail,
      onError: (uid, error) => log.error(`Could not warn the buyer of order ${uid}`, error),
    },
    new Date(),
    WEBAPP_URL
  );

  if (sent > 0) log.warn(`Warned ${sent} buyer(s) that their hold is about to lapse.`);
  return NextResponse.json({ ok: true, sent });
}

export const POST = defaultResponderForAppDir(postHandler);
