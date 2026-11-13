/**
 * An exhibitor at the counter asking for a room to be cancelled.
 *
 * The welcome desk has no way to cancel anything, and that is on purpose: a
 * cancellation refunds real money, and the tablet it would be pressed on sits
 * on a counter in a hall, signed in to a shared account. Every cancelling
 * procedure is admin-only and refused outright while desk mode is on.
 *
 * What was missing was the step before it. From the moment self-service
 * cancellation closes, an exhibitor who wants to give a room back has nowhere
 * to go but the desk — and the desk could only say "write to sales", which
 * leaves no trace, no owner and no clock. So the desk records the ask: who
 * asked, who took it, what they said. Nothing moves. The room stays sold, the
 * money stays put, and an admin decides.
 *
 * Pure: the rule and the words of the notification, with no transport and no
 * database, so both can be read in a test.
 */

export type RequestRefusal = "not-confirmed" | "already-requested" | "already-cancelled";

export interface RequestableBooking {
  status: string;
  /** Set once this room has been credited — there is nothing left to ask for. */
  creditNoteId: number | null;
  /** Set when a refund for this room has already been sent to Stripe. */
  bookerCancelledAt: Date | null;
  cancellationRequestedAt: Date | null;
}

export function canRequestCancellation(
  booking: RequestableBooking
): { allowed: true } | { allowed: false; reason: RequestRefusal } {
  if (booking.creditNoteId !== null || booking.bookerCancelledAt) {
    return { allowed: false, reason: "already-cancelled" };
  }
  if (booking.status !== "CONFIRMED") return { allowed: false, reason: "not-confirmed" };
  // Twice is not twice as loud; it is two mails about one room and a desk that
  // cannot tell whether the first was seen.
  if (booking.cancellationRequestedAt) return { allowed: false, reason: "already-requested" };
  return { allowed: true };
}

export function requestRefusalMessage(reason: RequestRefusal): string {
  switch (reason) {
    case "already-cancelled":
      return "This room has already been cancelled.";
    case "already-requested":
      return "A cancellation has already been asked for on this room. Sales have it.";
    case "not-confirmed":
      return "Only a paid booking can be given back. An unpaid hold frees itself.";
  }
}

export interface RequestNotificationInput {
  roomLabel: string;
  slotLabel: string;
  bookerName: string;
  bookerEmail: string;
  company: string | null;
  /** The hostess who took the request — the name on the tablet, not an account. */
  takenBy: string;
  note: string | null;
  /** Absolute link to the order, so the decision is one click from the mail. */
  orderUrl: string;
  orderRef: string;
}

/**
 * What sales are told. Written to be read on a phone, between two things:
 * the room, the day, the person, and the fact that nothing has happened yet.
 */
export function cancellationRequestNotification(input: RequestNotificationInput): {
  subject: string;
  body: string;
  html: string;
} {
  const who = input.company ? `${input.bookerName} (${input.company})` : input.bookerName;
  const subject = `Cancellation asked at the desk — ${input.roomLabel}, ${input.slotLabel}`;

  const lines = [
    `${who} asked the welcome desk to cancel a room.`,
    "",
    `Room:    ${input.roomLabel}`,
    `When:    ${input.slotLabel}`,
    `Contact: ${input.bookerEmail}`,
    `Order:   ${input.orderRef}`,
    `Taken by: ${input.takenBy}`,
  ];
  if (input.note) lines.push(`Said:    ${input.note}`);
  lines.push(
    "",
    "Nothing has been cancelled and nothing has been refunded — the room is still sold and still theirs.",
    `Decide here: ${input.orderUrl}`
  );

  const html = [
    `<p style="margin:0 0 14px"><strong>${escape(who)}</strong> asked the welcome desk to cancel a room.</p>`,
    `<p style="margin:0 0 4px"><strong>${escape(input.roomLabel)}</strong> — ${escape(input.slotLabel)}</p>`,
    `<p style="margin:0 0 14px;color:#555">${escape(input.bookerEmail)} · ${escape(
      input.orderRef
    )} · taken by ${escape(input.takenBy)}</p>`,
    input.note ? `<p style="margin:0 0 14px">“${escape(input.note)}”</p>` : "",
    `<p style="margin:0 0 14px">Nothing has been cancelled and nothing has been refunded — the room is still sold and still theirs.</p>`,
    `<p style="margin:0"><a href="${escape(input.orderUrl)}">Open the order</a></p>`,
  ].join("");

  return { subject, body: lines.join("\n"), html };
}

function escape(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
