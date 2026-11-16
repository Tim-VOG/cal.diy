import { ErrorCode } from "@calcom/lib/errorCodes";
import { ErrorWithCode } from "@calcom/lib/errors";
import { getAtomicSlotStarts, getBufferSlotStarts } from "./atomicSlots";
import type { DurationHours } from "./eventSchedule";

const MS_PER_MINUTE = 60 * 1000;

/** Earlier start, same end — or same start, later end. */
export type ExtensionDirection = "before" | "after";

export interface ExtensionParent {
  uid: string;
  startTime: Date;
  endTime: Date;
}

export interface ExtensionPlan {
  /** What the exhibitor gets, and what the invoice says. */
  startTime: Date;
  endTime: Date;
  durationMinutes: number;
  /**
   * The quarter-hours this booking claims for itself.
   *
   * Running later, this does NOT include the minutes the parent's cleaning gap
   * already covers — see the note on planExtension.
   */
  slotStarts: Date[];
  /**
   * The cleaning gap the continuation reserves after itself. Empty when
   * extending BEFORE: what follows is the exhibitor's own meeting, not a
   * turnover.
   */
  bufferSlots: Date[];
}

/**
 * Where a continuation of `parent` falls, and how it gets past the cleaning gap.
 *
 * The gap is the whole difficulty. Every booking reserves `bufferMinutes` after
 * itself as real slot rows, so two bookings can never touch — which is exactly
 * what a continuation must do. Refusing on those grounds would be reading the
 * rule wrong: the gap covers the turnover between DIFFERENT occupants, and an
 * exhibitor staying on in the same room turns nothing over.
 *
 * Running later, the continuation therefore starts its SLOTS after the parent's
 * gap instead of releasing it. The booking still begins when the meeting ended
 * — that is what is sold, shown and invoiced — but the first quarter-hours stay
 * owned by the meeting itself. Nobody else can take them either way, since the
 * parent holds them, and the room is covered end to end.
 *
 * That is deliberate, and the alternative is worse. Releasing the parent's rows
 * and claiming them would leave the meeting with no gap at all the moment the
 * continuation went away — an admin cancelling it, a lapsed hold, a failed
 * Stripe call — and a stranger could then book flush against a paid meeting.
 * Restoring the gap on each of those paths is a promise to remember it on every
 * future one. Never taking it is a promise that keeps itself.
 *
 * Starting earlier needs none of this: the continuation reserves no trailing
 * gap, because the meeting begins the moment it ends, and the meeting's own gap
 * still closes the run.
 *
 * Either way the invariant is unchanged: `bufferMinutes` free after the last
 * booking of the run before anybody else can start. Nothing here touches the
 * unique index on (resourceId, slotStart) — this returns a plan and writes
 * nothing, so whoever actually holds the hour still decides.
 */
export function planExtension(input: {
  parent: ExtensionParent;
  direction: ExtensionDirection;
  durationHours: DurationHours;
  bufferMinutes: number;
  /** Slot marks the event is open on, as epoch ms. */
  openSlotMs: ReadonlySet<number>;
  /** Treated as already past; a continuation cannot start behind the clock. */
  now?: Date;
}): ExtensionPlan {
  const outcome = describeExtension(input);
  if (!outcome.ok) throw new ErrorWithCode(ErrorCode.BadRequest, outcome.reason);
  return outcome.plan;
}

export type ExtensionOutcome =
  | { ok: true; plan: ExtensionPlan }
  | { ok: false; reason: string; plan?: ExtensionPlan };

/**
 * The same decision as planExtension, without throwing — so a screen can offer
 * only what would actually work.
 *
 * The admin screen used to let a hostess pick a direction and a length that
 * could not possibly be sold, and say so only once the write had failed: with
 * a room booked back to back all day, every choice refused and nothing on the
 * page hinted at why. Given `takenSlotMs` it also answers whether the hours
 * are free, which is a question only the screen asks — the server lets the
 * unique index answer it, because between asking and writing somebody else can
 * buy the room.
 */
export function describeExtension(input: {
  parent: ExtensionParent;
  direction: ExtensionDirection;
  durationHours: DurationHours;
  bufferMinutes: number;
  openSlotMs: ReadonlySet<number>;
  /** Quarter-hours already held in this room, when the caller knows them. */
  takenSlotMs?: ReadonlySet<number>;
  /** Treated as already past; a continuation cannot start behind the clock. */
  now?: Date;
}): ExtensionOutcome {
  const durationMinutes = input.durationHours * 60;
  const startTime =
    input.direction === "after"
      ? new Date(input.parent.endTime.getTime())
      : new Date(input.parent.startTime.getTime() - durationMinutes * MS_PER_MINUTE);
  const endTime = new Date(startTime.getTime() + durationMinutes * MS_PER_MINUTE);

  // Throws on a duration or a boundary the slot model does not allow, which is
  // the same gate every sale goes through.
  const allMarks = getAtomicSlotStarts(startTime, durationMinutes);

  // Checked across the WHOLE range, including the minutes the parent's gap
  // covers: the exhibitor is in the room for those too.
  for (const slot of allMarks) {
    if (!input.openSlotMs.has(slot.getTime())) {
      return {
        ok: false,
        reason:
          input.direction === "before"
            ? "Starting that much earlier falls outside the event opening hours."
            : "Running that much later falls outside the event opening hours.",
      };
    }
  }

  const parentGapEndsAt =
    input.direction === "after"
      ? input.parent.endTime.getTime() + Math.max(0, input.bufferMinutes) * MS_PER_MINUTE
      : Number.NEGATIVE_INFINITY;

  const plan: ExtensionPlan = {
    startTime,
    endTime,
    durationMinutes,
    slotStarts: allMarks.filter((m) => m.getTime() >= parentGapEndsAt),
    bufferSlots:
      input.direction === "after" ? getBufferSlotStarts(startTime, durationMinutes, input.bufferMinutes) : [],
  };

  const now = input.now;
  if (now && startTime.getTime() <= now.getTime()) {
    return {
      ok: false,
      plan,
      reason:
        input.direction === "before"
          ? "That meeting has already started, so it cannot be made to start earlier."
          : "That time has already passed.",
    };
  }

  // Only when the caller knows the room. The server does not pass this: the
  // unique index is what decides, and anything read before the write is a
  // guess that a concurrent buyer can invalidate.
  const taken = input.takenSlotMs;
  if (taken) {
    for (const mark of [...plan.slotStarts, ...plan.bufferSlots]) {
      if (taken.has(mark.getTime())) {
        return { ok: false, plan, reason: "Those hours are already taken in this room." };
      }
    }
  }

  return { ok: true, plan };
}
