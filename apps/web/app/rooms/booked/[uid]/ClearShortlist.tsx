"use client";

import { useEffect } from "react";
import { SELECTIONS_CHANGED, clearAllSelections } from "../../selectionStore";

/**
 * Empty the shortlist once the buyer reaches their confirmation.
 *
 * The shortlist survived payment, so the rooms just bought were still sitting
 * in it. The panel then read those days as already booked, refused to let
 * anything else be paid for, and the exhibitor had to delete each line by hand
 * before they could buy a second room.
 */
export default function ClearShortlist(): null {
  useEffect(() => {
    clearAllSelections();
    globalThis.dispatchEvent(new Event(SELECTIONS_CHANGED));
  }, []);
  return null;
}
