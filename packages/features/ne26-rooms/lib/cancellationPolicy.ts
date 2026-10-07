/**
 * When an exhibitor may cancel a room they have already paid for.
 *
 * Self-service cancellation refunds real money, so the rule is narrow and lives
 * in one pure place: the button, the procedure behind it and the tests all read
 * it from here. A screen that hides the button is not a rule — the procedure is.
 *
 * One deadline for the whole event rather than one per booking: an exhibitor
 * holding three rooms over three days should not have to remember three dates,
 * and the desk answers one question instead of three.
 */

const DAYS_BEFORE_EVENT = 7;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** The room being cancelled, and the payment behind it. */
export interface CancellableBooking {
  status: string;
  /** Set once this room has been credited: a second cancellation would refund nothing. */
  creditNoteId: number | null;
  /** Set the moment a refund for this room was sent to Stripe. */
  bookerCancelledAt: Date | null;
  order: {
    status: string;
    /** Null for a bank transfer or a counter sale: there is no card to give back. */
    stripePaymentId: string | null;
    /** No invoice, no credit note: refunding would leave money out and nothing to show for it. */
    invoiceNumber: string | null;
  } | null;
}

export type CancellationRefusal =
  | "not-confirmed"
  | "already-cancelled"
  | "deadline-passed"
  | "no-card-payment"
  | "no-invoice";

/**
 * The instant self-service cancellation closes: seven days before the first
 * bookable minute of the event. Past it the rooms are being planned for, and a
 * cancellation goes through the desk.
 */
export function cancellationDeadline(schedule: readonly { openSlotStartsUtc: Date[] }[]): Date | null {
  // The EARLIEST minute, not the first in the list: the days are configured by
  // hand in the admin and nothing keeps them in order.
  const opens = schedule.flatMap((day) => day.openSlotStartsUtc).map((d) => d.getTime());
  return opens.length ? new Date(Math.min(...opens) - DAYS_BEFORE_EVENT * MS_PER_DAY) : null;
}

/**
 * Whether this exhibitor may cancel this room right now, and if not, why — the
 * reason is what the page tells them, so it must say which of the four it is.
 *
 * One room at a time: an exhibitor who paid for three rooms in one go cancels
 * the Wednesday and keeps the Tuesday, and only the Wednesday is refunded.
 */
export function canBookerCancel(
  booking: CancellableBooking,
  now: Date,
  deadline: Date | null
): { allowed: true } | { allowed: false; reason: CancellationRefusal } {
  if (booking.creditNoteId !== null || booking.bookerCancelledAt) {
    return { allowed: false, reason: "already-cancelled" };
  }
  if (booking.status !== "CONFIRMED" || booking.order?.status !== "CONFIRMED") {
    return { allowed: false, reason: "not-confirmed" };
  }
  if (!booking.order.stripePaymentId) return { allowed: false, reason: "no-card-payment" };
  // The credit note cancels an invoice. Without one there is nothing to cancel,
  // and refunding first would put money out with no document behind it.
  if (!booking.order.invoiceNumber) return { allowed: false, reason: "no-invoice" };
  if (deadline && now.getTime() >= deadline.getTime()) {
    return { allowed: false, reason: "deadline-passed" };
  }
  return { allowed: true };
}

/** What the exhibitor is told when they cannot cancel themselves. */
export function refusalMessage(reason: CancellationRefusal, contactEmail: string): string {
  switch (reason) {
    case "already-cancelled":
      return "This room has already been cancelled. Your credit note is on its way by email.";
    case "not-confirmed":
      return "Only a paid booking can be cancelled here.";
    case "no-card-payment":
      return `This booking was not paid by card, so it cannot be refunded automatically. Write to ${contactEmail} and we will take care of it.`;
    case "deadline-passed":
      return `Cancellation online has closed. Write to ${contactEmail} and we will see what we can do.`;
    case "no-invoice":
      return `This booking has no invoice yet. Write to ${contactEmail} and we will sort it out.`;
  }
}
