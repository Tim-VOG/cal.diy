import { getNe26OrderRepository } from "@calcom/features/ne26-rooms/di/Ne26OrderRepository.container";
import { sendHoldReminderEmail } from "@calcom/features/ne26-rooms/lib/mailer";
import { runHoldNotices } from "@calcom/features/ne26-rooms/services/HoldReminderService";
import { WEBAPP_URL } from "@calcom/lib/constants";
import logger from "@calcom/lib/logger";
import { defaultResponderForAppDir } from "app/api/defaultResponderForAppDir";
import { timingSafeEqual } from "node:crypto";
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

const log = logger.getSubLogger({ prefix: ["[ne26-hold-reminders]"] });

/**
 * Write to buyers holding rooms they have not paid for: once when the hold has
 * been standing a few minutes, and again before it lapses.
 *
 * Meant to run every few minutes. Safe to run more often, and safe to overlap:
 * each reminder is claimed in the database before it is sent, so a slow run
 * cannot make the next one mail the same buyer again.
 *
 * Authenticated with CRON_API_KEY — this sends mail on our behalf, so it must
 * not be open to the internet.
 *
 * The key is read from the Authorization header ONLY. It used to be accepted
 * as `?apiKey=` too, which put a live secret into every proxy access log, every
 * server log line and every browser history that ever touched the URL. A query
 * string is not a place to carry a credential.
 */
function isAuthorised(req: NextRequest): boolean {
  const expected = process.env.CRON_API_KEY;
  const supplied = req.headers.get("authorization");
  if (!expected || !supplied) return false;
  const a = Buffer.from(expected);
  const b = Buffer.from(supplied);
  // Compared in constant time, and only when the lengths already match —
  // timingSafeEqual throws on a length mismatch, which would itself leak it.
  return a.length === b.length && timingSafeEqual(a, b);
}

async function postHandler(req: NextRequest): Promise<Response> {
  if (!isAuthorised(req)) {
    return NextResponse.json({ message: "Not authenticated" }, { status: 401 });
  }

  const orders = getNe26OrderRepository();
  const { sent } = await runHoldNotices(
    {
      findHoldsExpiringSoon: (from, before) => orders.findHoldsExpiringSoon(from, before),
      findHoldsOpenedBefore: (cutoff, now) => orders.findHoldsOpenedBefore(cutoff, now),
      claimHoldNotice: (uid, at, notifiedBefore) => orders.claimHoldNotice(uid, at, notifiedBefore),
      sendReminder: sendHoldReminderEmail,
      onError: (uid, error) => log.error(`Could not warn the buyer of order ${uid}`, error),
    },
    new Date(),
    WEBAPP_URL
  );

  if (sent > 0) log.warn(`Sent ${sent} hold notice(s).`);
  return NextResponse.json({ ok: true, sent });
}

export const POST = defaultResponderForAppDir(postHandler);
