import { ErrorCode } from "@calcom/lib/errorCodes";
import { ErrorWithCode } from "@calcom/lib/errors";
import { getInvoiceService } from "../di/InvoiceService.container";
import { getNe26RoomSettingsRepository } from "../di/Ne26RoomSettingsRepository.container";
import { getResourceBookingRepository } from "../di/ResourceBookingRepository.container";
import { getAtomicSlotStarts, getBufferSlotStarts } from "../lib/atomicSlots";
import { buildEventSchedule, buildOpenSlotMs } from "../lib/eventSchedule";
import { formatSlotRange } from "../lib/teamNotification";

export interface MoveBookingInput {
  bookingUid: string;
  /** Where it goes. Same room, same length — only the clock changes. */
  newStartUtc: Date;
}

export interface MovedBooking {
  bookingUid: string;
  roomName: string;
  bookerEmail: string;
  bookerName: string;
  /** Where it was and where it is now, already formatted for a human. */
  fromLabel: string;
  toLabel: string;
  /** Whether the issued invoice was redrawn to match. */
  invoiceRedrawn: boolean;
}

/**
 * Put an existing booking at a different time, in the same room.
 *
 * The case this exists for: an exhibitor asks the desk to shift their meeting
 * by an hour. Cancelling and re-selling would raise a credit note and a second
 * invoice for a sale that never reversed — two documents and a refund to
 * explain, for a change that costs nothing. Same room and same length means
 * the same price, so no money moves at all: the booking is restated and its
 * invoice is redrawn under its own number, because only the line describing
 * the slot was wrong.
 *
 * Admin-only, and deliberately narrow. It will not move a booking that was
 * sold as part of a run with extra time, in either direction: those two
 * bookings touch on purpose, and sliding one away from the other would leave
 * the exhibitor holding two disconnected pieces of a meeting they asked for as
 * one. The admin releases the continuation first, or the move is refused.
 *
 * What stops a move onto somebody else's hour is the unique index, as always.
 * Nothing here checks availability beforehand: between the check and the write
 * another buyer can take the room, and the write is where that is settled.
 */
export async function moveBooking(input: MoveBookingInput): Promise<MovedBooking> {
  const bookings = getResourceBookingRepository();
  const booking = await bookings.findForMove(input.bookingUid);

  if (!booking || booking.isBlock) {
    throw new ErrorWithCode(ErrorCode.NotFound, "That booking no longer exists.");
  }
  if (booking.status === "CANCELLED") {
    throw new ErrorWithCode(
      ErrorCode.BadRequest,
      "That booking has been cancelled, so there is nothing to move."
    );
  }
  if (booking.extendsBookingUid) {
    throw new ErrorWithCode(
      ErrorCode.BadRequest,
      "That booking is extra time attached to another meeting. Moving it would separate the two — cancel it and sell the time where it is wanted instead."
    );
  }

  const continuations = await bookings.findContinuationsOf([booking.uid]);
  const live = continuations.filter((c) => c.status !== "CANCELLED");
  if (live.length > 0) {
    throw new ErrorWithCode(
      ErrorCode.BadRequest,
      "Extra time has been sold onto this meeting, and the two were sold as one run. Cancel the extra time first, then move the meeting."
    );
  }

  const newStart = input.newStartUtc;
  if (newStart.getTime() === booking.startTime.getTime()) {
    throw new ErrorWithCode(ErrorCode.BadRequest, "That is where the booking already is.");
  }
  if (newStart.getTime() <= Date.now()) {
    throw new ErrorWithCode(ErrorCode.BadRequest, "That time has already passed.");
  }

  const settings = await getNe26RoomSettingsRepository().get();
  const openSlotMs = buildOpenSlotMs(buildEventSchedule(settings.eventDays));

  // Throws on a boundary or a length the slot model does not allow — the same
  // gate every sale goes through.
  const slotStarts = getAtomicSlotStarts(newStart, booking.durationMinutes);
  for (const slot of slotStarts) {
    if (!openSlotMs.has(slot.getTime())) {
      throw new ErrorWithCode(
        ErrorCode.BadRequest,
        "That time falls outside the event opening hours."
      );
    }
  }

  const endTime = new Date(newStart.getTime() + booking.durationMinutes * 60_000);
  const bufferSlots = getBufferSlotStarts(newStart, booking.durationMinutes, settings.bufferMinutes);
  const fromLabel = formatSlotRange(booking.startTime, booking.endTime);

  await bookings.moveBookingSlots({
    uid: booking.uid,
    startTime: newStart,
    endTime,
    slotStarts: [...slotStarts, ...bufferSlots],
  });

  // Redrawn after the move, so it describes where the meeting actually is. The
  // number, the amount and the issue date are untouched; a failure here must
  // not undo a move that has already happened, so it is reported rather than
  // thrown.
  let invoiceRedrawn = false;
  if (booking.order?.uid && booking.order.invoiceNumber) {
    try {
      invoiceRedrawn = await getInvoiceService().redrawInvoice(booking.order.uid);
    } catch (error) {
      console.error("[ne26] invoice redraw after move failed", error);
    }
  }

  return {
    bookingUid: booking.uid,
    roomName: booking.resource.name,
    bookerEmail: booking.bookerEmail,
    bookerName: booking.bookerName,
    fromLabel,
    toLabel: formatSlotRange(newStart, endTime),
    invoiceRedrawn,
  };
}
