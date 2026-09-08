import { EVENT_TIME_ZONE, EVENT_TIME_ZONE_LABEL } from "../lib/eventSchedule";
import { formatSlotRange } from "../lib/teamNotification";

/**
 * How far ahead of the lapse a buyer is warned. A quarter of an hour is enough
 * to finish a payment already started, and short enough that the warning still
 * means something.
 */
export const REMINDER_LEAD_MINUTES = 15;

/**
 * How long a hold is left alone before the buyer is told about it.
 *
 * It used to go out the instant the rooms were held, which meant two useless
 * mails: one to a buyer already being redirected to Stripe, arriving while the
 * payment page loaded, and one to a buyer who paid a minute later. The people
 * who need it are the ones who wandered off, and they are still there after
 * eight minutes. By then the mail also states what is really left — twenty-seven
 * minutes of the thirty-five, not thirty-five.
 */
export const OPENING_NOTICE_DELAY_MINUTES = 8;

/** Event-local wall clock, e.g. "14:35" — the hold lapses at a time, not a date. */
export function holdExpiryLabel(at: Date): string {
  // Named, always. This is the one clock in the product that is NOT an event
  // time: it runs today, wherever the buyer happens to be, months before
  // anybody travels to Izmir. Rendered in the event's zone and left unlabelled,
  // "until 22:33" read as 22:33 to a buyer in Brussels whose hold actually
  // lapsed at 21:33 — an hour of false confidence in September, two in
  // November, on a countdown with money at the end of it.
  const time = new Intl.DateTimeFormat("en-GB", {
    timeZone: EVENT_TIME_ZONE,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(at);
  return `${time} ${EVENT_TIME_ZONE_LABEL}`;
}

/** Rounded up: "0 minutes left" on a hold that still has forty seconds is a lie. */
export function minutesUntil(expiresAt: Date, now: Date): number {
  return Math.max(0, Math.ceil((expiresAt.getTime() - now.getTime()) / 60000));
}

/** One room named and the rest counted, as everywhere else in the product. */
export function roomLabelFor(rooms: { resource: { name: string } }[]): string {
  const [first, ...rest] = rooms;
  if (!first) return "your meeting room";
  return rest.length === 0 ? first.resource.name : `${first.resource.name} + ${rest.length} more`;
}

/** A held order, as both passes need to see it. */
export interface HoldOnNotice {
  uid: string;
  bookerName: string;
  bookerEmail: string;
  holdExpiresAt: Date | null;
  /** When this buyer was last written to about this hold. */
  holdReminderSentAt: Date | null;
  bookings: { startTime: Date; endTime: Date; resource: { name: string } }[];
}

export interface HoldReminderDeps {
  findHoldsExpiringSoon: (from: Date, before: Date) => Promise<HoldOnNotice[]>;
  /** Holds older than the delay that nobody has been written to about yet. */
  findHoldsOpenedBefore: (cutoff: Date, now: Date) => Promise<HoldOnNotice[]>;
  claimHoldNotice: (uid: string, at: Date, notifiedBefore: Date | null) => Promise<boolean>;
  sendReminder: (input: {
    to: string;
    bookerName: string;
    roomName: string;
    slotLabel: string;
    expiresAtLabel: string;
    minutesLeft: number;
    kind: "created" | "expiring";
    payUrl: string;
  }) => Promise<void>;
  /** Logged rather than thrown: one bad address must not stop the rest. */
  onError: (uid: string, error: unknown) => void;
}

/**
 * Every message a held, unpaid order earns: the opening notice, then the warning
 * before it lapses.
 *
 * Driven by a cron, so it is written to be run repeatedly and overlappingly:
 * each message is CLAIMED before it is sent, and a claim that loses sends
 * nothing. Sending first and marking after would mail the same buyer on every
 * pass whenever the mail is slow.
 *
 * Claiming before sending means a send that fails is not retried — deliberate.
 * A buyer mailed twice about the same fifteen minutes is worse than one who
 * misses a warning about a hold they can still see counting down on the site.
 *
 * The opening pass runs first. On a hold short enough for both to fall due in
 * the same run, the buyer should hear that a clock exists before hearing it is
 * nearly up.
 */
export async function runHoldNotices(
  deps: HoldReminderDeps,
  now: Date,
  webappUrl: string
): Promise<{ sent: number }> {
  let sent = 0;

  const send = async (
    order: HoldOnNotice,
    kind: "created" | "expiring",
    notifiedBefore: Date | null
  ): Promise<void> => {
    if (!order.holdExpiresAt || !order.bookerEmail) return;
    if (!(await deps.claimHoldNotice(order.uid, now, notifiedBefore))) return;
    try {
      const first = order.bookings[0];
      await deps.sendReminder({
        to: order.bookerEmail,
        bookerName: order.bookerName || "there",
        roomName: roomLabelFor(order.bookings),
        slotLabel: first ? formatSlotRange(first.startTime, first.endTime) : "",
        expiresAtLabel: holdExpiryLabel(order.holdExpiresAt),
        // Always measured against the real expiry, never assumed from the hold's
        // nominal length: by the time this goes out, eight of the thirty-five
        // minutes are gone.
        minutesLeft: minutesUntil(order.holdExpiresAt, now),
        kind,
        payUrl: `${webappUrl}/rooms/bookings`,
      });
      sent += 1;
    } catch (e) {
      deps.onError(order.uid, e);
    }
  };

  const openedBefore = new Date(now.getTime() - OPENING_NOTICE_DELAY_MINUTES * 60_000);
  for (const order of await deps.findHoldsOpenedBefore(openedBefore, now)) {
    await send(order, "created", null);
  }

  const before = new Date(now.getTime() + REMINDER_LEAD_MINUTES * 60_000);
  for (const order of await deps.findHoldsExpiringSoon(now, before)) {
    if (!order.holdExpiresAt) continue;
    // The moment this hold entered its final quarter of an hour. A message sent
    // before then was the opening one, so the warning is still owed; one sent
    // after was the warning itself.
    const finalStretch = new Date(order.holdExpiresAt.getTime() - REMINDER_LEAD_MINUTES * 60_000);
    if (order.holdReminderSentAt && order.holdReminderSentAt >= finalStretch) continue;
    await send(order, "expiring", finalStretch);
  }

  return { sent };
}
