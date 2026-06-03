import { AddOnPriceType } from "@calcom/prisma/enums";

export interface AddOnLine {
  quantity: number;
  lineTotal: number;
}

/**
 * Compute an add-on line given its pricing mode. Prices are in cents.
 * - FLAT: fixed price, quantity forced to 1.
 * - PER_PERSON: unitPrice × requested quantity (e.g. catering covers).
 * - PER_HOUR: unitPrice × booking duration in hours.
 */
export function computeAddOnLine(
  priceType: AddOnPriceType,
  unitPrice: number,
  requestedQuantity: number,
  durationHours: number
): AddOnLine {
  switch (priceType) {
    case AddOnPriceType.PER_PERSON: {
      const quantity = Math.max(1, Math.floor(requestedQuantity));
      return { quantity, lineTotal: unitPrice * quantity };
    }
    case AddOnPriceType.PER_HOUR:
      return { quantity: durationHours, lineTotal: unitPrice * durationHours };
    default:
      return { quantity: 1, lineTotal: unitPrice };
  }
}
