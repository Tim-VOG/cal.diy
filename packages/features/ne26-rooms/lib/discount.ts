/**
 * Extended-use discount, derived from the room's own prices.
 *
 * VO's grid bakes the reduction into the 2h and 3h prices rather than storing a
 * percentage (720 / 1296 / 1836 = -10% / -15%). Deriving it here means the badge
 * on the page always matches what is actually charged: change a price in the
 * admin and the displayed percentage follows, with nothing to keep in sync.
 *
 * Returns null when there is no saving — a flat grid, or a longer slot priced at
 * or above the hourly rate — so the UI simply shows nothing.
 */
export function extendedUseDiscountPct(
  hourlyPrice: number,
  durationPrice: number,
  durationHours: number
): number | null {
  if (durationHours < 2 || hourlyPrice <= 0) return null;
  const undiscounted = hourlyPrice * durationHours;
  if (durationPrice >= undiscounted) return null;
  return Math.round(((undiscounted - durationPrice) / undiscounted) * 100);
}

/**
 * The wording VO uses, kept next to the calculation so the two can't drift.
 * The last sentence matters commercially: booking 1h twice is not the same deal
 * as booking 2h once, and buyers do ask.
 */
export const EXTENDED_USE_DISCOUNT_NOTE =
  "A discount is provided for extended use: -10% for 2 consecutive hours, -15% for 3 consecutive hours. The discount does not apply to 2x 1 hour meeting space rentals.";
