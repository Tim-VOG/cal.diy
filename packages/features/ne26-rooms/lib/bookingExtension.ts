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
  startTime: Date;
  endTime: Date;
  durationMinutes: number;
  /** The quarter-hours the extension occupies. */
  slotStarts: Date[];
  /**
   * The cleaning gap the extension reserves after itself. Empty when extending
   * BEFORE: what follows is the exhibitor's own meeting, not a turnover.
   */
  bufferSlots: Date[];
  /**
   * Quarter-hours currently held as the parent's trailing cleaning gap, which
   * the extension takes over. Empty when extending BEFORE, where the parent's
   * own gap is untouched and still sits after the whole run.
   */
  releasesParentBufferFrom: Date | null;
}

/**
 * Where a continuation of `parent` falls, and what it does to the cleaning gap.
 *
 * The gap is the only hard part. Every booking reserves `bufferMinutes` after
 * itself as real slot rows, so two bookings can never touch — which is exactly
 * what a continuation has to do. Treating that as a reason to refuse would be
 * reading the rule wrong: the gap exists for the turnover between DIFFERENT
 * occupants, and the same exhibitor staying on in the same room turns nothing
 * over.
 *
 * So the gap is handed on rather than waived. Extending AFTER, the parent's
 * trailing slots are released and the extension reserves its own gap past its
 * new end. Extending BEFORE, the extension reserves no trailing gap at all —
 * the parent's meeting begins the moment it ends — and the parent's own gap
 * still closes the run. Either way the invariant holds: fifteen free minutes
 * after the last booking of the run, before anybody else can start.
 *
 * Nothing here touches the unique index on (resourceId, slotStart). If somebody
 * else holds the hour being claimed, the insert fails, which is the intended
 * outcome and the reason this returns a plan rather than writing anything.
 */
export function planExtension(input: {
  parent: ExtensionParent;
  direction: ExtensionDirection;
  durationHours: DurationHours;
  bufferMinutes: number;
  /** Slot marks the event is open on, as epoch ms. */
  openSlotMs: ReadonlySet<number>;
}): ExtensionPlan {
  const durationMinutes = input.durationHours * 60;
  const startTime =
    input.direction === "after"
      ? new Date(input.parent.endTime.getTime())
      : new Date(input.parent.startTime.getTime() - durationMinutes * MS_PER_MINUTE);
  const endTime = new Date(startTime.getTime() + durationMinutes * MS_PER_MINUTE);

  // Throws on a duration or a boundary the slot model does not allow, which is
  // the same gate every sale goes through.
  const slotStarts = getAtomicSlotStarts(startTime, durationMinutes);

  for (const slot of slotStarts) {
    if (!input.openSlotMs.has(slot.getTime())) {
      throw new ErrorWithCode(
        ErrorCode.BadRequest,
        input.direction === "before"
          ? "Starting that much earlier falls outside the event opening hours."
          : "Running that much later falls outside the event opening hours."
      );
    }
  }

  return {
    startTime,
    endTime,
    durationMinutes,
    slotStarts,
    bufferSlots:
      input.direction === "after" ? getBufferSlotStarts(startTime, durationMinutes, input.bufferMinutes) : [],
    // Extending after, the parent's gap starts exactly where the extension
    // does, so the rows to release are the parent's own slots at or after its
    // end. Extending before, nothing of the parent's is released.
    releasesParentBufferFrom: input.direction === "after" ? new Date(input.parent.endTime.getTime()) : null,
  };
}
