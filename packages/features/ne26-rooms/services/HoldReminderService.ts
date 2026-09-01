import { EVENT_TIME_ZONE } from "../lib/eventSchedule";
import { formatSlotRange } from "../lib/teamNotification";

/**
 * How far ahead of the lapse a buyer is warned. A quarter of an hour is enough
 * to finish a payment already started, and short enough that the warning still
 * means something.
 */
export const REMINDER_LEAD_MINUTES = 15;

/** Event-local wall clock, e.g. "14:35" — the hold lapses at a time, not a date. */
export function holdExpiryLabel(at: Date): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: EVENT_TIME_ZONE,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(at);
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

export interface HoldReminderDeps {
  findHoldsExpiringSoon: (
    from: Date,
    before: Date
  ) => Promise<
    {
      uid: string;
      bookerName: string;
      bookerEmail: string;
      holdExpiresAt: Date | null;
      bookings: { startTime: Date; endTime: Date; resource: { name: string } }[];
    }[]
  >;
  claimHoldReminder: (uid: string, at: Date) => Promise<boolean>;
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
 * Warn every buyer whose hold is about to lapse, once.
 *
 * Driven by a cron, so it is written to be run repeatedly and overlappingly:
 * the reminder is CLAIMED before the mail is sent, and a claim that loses sends
 * nothing. Sending first and marking after would mail the same buyer on every
 * pass whenever the mail is slow.
 *
 * Claiming before sending means a send that fails is not retried — deliberate.
 * A buyer mailed twice about the same fifteen minutes is worse than one who
 * misses a warning about a hold they can still see counting down on the site.
 */
export async function remindExpiringHolds(
  deps: HoldReminderDeps,
  now: Date,
  webappUrl: string
): Promise<{ sent: number }> {
  const before = new Date(now.getTime() + REMINDER_LEAD_MINUTES * 60_000);
  const due = await deps.findHoldsExpiringSoon(now, before);

  let sent = 0;
  for (const order of due) {
    if (!order.holdExpiresAt || !order.bookerEmail) continue;
    if (!(await deps.claimHoldReminder(order.uid, now))) continue;
    try {
      const first = order.bookings[0];
      await deps.sendReminder({
        to: order.bookerEmail,
        bookerName: order.bookerName || "there",
        roomName: roomLabelFor(order.bookings),
        slotLabel: first ? formatSlotRange(first.startTime, first.endTime) : "",
        expiresAtLabel: holdExpiryLabel(order.holdExpiresAt),
        minutesLeft: minutesUntil(order.holdExpiresAt, now),
        kind: "expiring",
        payUrl: `${webappUrl}/rooms/bookings`,
      });
      sent += 1;
    } catch (e) {
      deps.onError(order.uid, e);
    }
  }
  return { sent };
}
