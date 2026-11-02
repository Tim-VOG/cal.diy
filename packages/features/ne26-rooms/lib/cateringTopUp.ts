/**
 * Adding catering to a room that is already booked and paid for.
 *
 * An exhibitor who takes a room on Monday and decides on Thursday that the
 * meeting should have lunch had no way to say so: add-ons could only be chosen
 * inside the original checkout. This is the rule layer for the second sale —
 * the money and the documents live in a service, these are the decisions it
 * makes, pure and in one place so the button, the procedure and the tests all
 * read the same rules.
 *
 * Nothing here claims a slot: the room is already theirs. The anti-double-
 * booking constraint is not involved in a top-up at all, which is what makes
 * selling catering after the fact safe.
 *
 * Whether catering is on sale at all is not a rule this module computes. It is
 * the `cateringSalesOpen` setting, which an admin opens and closes by hand: the
 * kitchen's own deadline is a conversation between the organiser and the
 * caterer, not a clock the platform should second-guess. One switch, and
 * everything here obeys it.
 */

import { AddOnPriceType } from "@calcom/prisma/enums";
import { minimumCoversFor } from "./pricing";

/** The room a top-up would be added to, as far as these rules are concerned. */
export interface TopUppableBooking {
  status: string;
  startTime: Date;
  /** Set once this room has been credited: it is no longer anybody's room. */
  creditNoteId: number | null;
  /** Set the moment a refund for this room was sent to Stripe. */
  bookerCancelledAt: Date | null;
  isBlock: boolean;
  order: { status: string } | null;
}

export type TopUpRefusal = "not-confirmed" | "already-cancelled" | "sales-closed";

/**
 * Whether catering can still be added to this room right now, and if not, why —
 * the reason is what the exhibitor is shown, so it has to say which it is.
 *
 * `salesOpen` is the admin switch, read from the room settings by the caller.
 * It is the last check rather than the first on purpose: a cancelled room is
 * told it is cancelled, which is the more useful thing to know.
 */
export function canTopUp(
  booking: TopUppableBooking,
  options: { salesOpen: boolean }
): { allowed: true } | { allowed: false; reason: TopUpRefusal } {
  if (booking.creditNoteId !== null || booking.bookerCancelledAt) {
    return { allowed: false, reason: "already-cancelled" };
  }
  if (booking.isBlock || booking.status !== "CONFIRMED" || booking.order?.status !== "CONFIRMED") {
    return { allowed: false, reason: "not-confirmed" };
  }
  if (!options.salesOpen) return { allowed: false, reason: "sales-closed" };
  return { allowed: true };
}

/** What the exhibitor is told when catering can no longer be added. */
export function topUpRefusalMessage(reason: TopUpRefusal, context: { contactEmail: string }): string {
  switch (reason) {
    case "already-cancelled":
      return "This room has been cancelled, so nothing can be added to it.";
    case "not-confirmed":
      return "Catering can only be added to a room that is paid for.";
    case "sales-closed":
      return `Catering is no longer on sale — the kitchen's order is already placed. The room itself is unaffected. Write to ${context.contactEmail} if you need to ask.`;
  }
}

/** One per-person add-on already on the room, whichever order paid for it. */
export interface ExistingCover {
  addOnId: number;
  quantity: number;
}

export type CoverRefusal =
  | { kind: "over-capacity"; capacity: number; alreadyOrdered: number }
  | { kind: "under-minimum"; minimum: number; total: number };

/**
 * Whether this many extra covers of a per-person add-on can be added.
 *
 * Both rules are checked against the TOTAL for that product on the room, not
 * against the increment. Capacity, because six lunches plus six more still
 * cannot be served in a room that seats eight. The caterer's minimum, because
 * an exhibitor topping up an existing order of six by two is not asking the
 * kitchen for a table of two — refusing that would be the rule misfiring on the
 * one case it was never written for.
 */
export function checkTopUpCovers(input: {
  priceType: AddOnPriceType;
  addOnId: number;
  requested: number;
  existing: readonly ExistingCover[];
  roomCapacity: number;
  roomCategory: string;
}): { ok: true } | { ok: false; refusal: CoverRefusal } {
  if (input.priceType !== AddOnPriceType.PER_PERSON) return { ok: true };

  const alreadyOrdered = input.existing
    .filter((e) => e.addOnId === input.addOnId)
    .reduce((sum, e) => sum + e.quantity, 0);
  const total = alreadyOrdered + input.requested;

  if (total > input.roomCapacity) {
    return {
      ok: false,
      refusal: { kind: "over-capacity", capacity: input.roomCapacity, alreadyOrdered },
    };
  }
  const minimum = minimumCoversFor(input.roomCategory);
  if (total < minimum) return { ok: false, refusal: { kind: "under-minimum", minimum, total } };
  return { ok: true };
}

/** What the exhibitor is told when the covers don't work out. */
export function coverRefusalMessage(addOnName: string, refusal: CoverRefusal): string {
  if (refusal.kind === "over-capacity") {
    const left = Math.max(0, refusal.capacity - refusal.alreadyOrdered);
    return refusal.alreadyOrdered > 0
      ? `This room seats ${refusal.capacity} and ${refusal.alreadyOrdered} ${addOnName.toLowerCase()} covers are already ordered, so you can add ${left} more.`
      : `"${addOnName}" is priced per person and this room seats ${refusal.capacity}.`;
  }
  return `"${addOnName}" is served for a minimum of ${refusal.minimum} people in this room.`;
}
