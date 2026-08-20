import { ErrorCode } from "@calcom/lib/errorCodes";
import { ErrorWithCode } from "@calcom/lib/errors";
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

/** An add-on as stored in the catalogue, with everything needed to price a line. */
export interface AddOnCatalogEntry {
  id: number;
  slug: string;
  name: string;
  price: number;
  priceType: AddOnPriceType;
  vatRate: number;
}

export interface ResolvedAddOnLine {
  addOnId: number;
  name: string;
  quantity: number;
  /** Frozen at order time — never re-read from the live catalogue. */
  unitPrice: number;
  lineTotal: number;
  vatRate: number;
}

/**
 * Turn a buyer's requested add-ons into priced lines, applying every rule that
 * must hold identically for the VAT preview and for the actual charge.
 *
 * This lives here, shared, on purpose: the preview and the booking resolved
 * add-ons through two separate copies of this logic, which is how a quoted total
 * and a charged total drift apart.
 *
 * Validation, all server-side (the client is never trusted for prices):
 * - unknown or deactivated slug → rejected, so a stale page can't order a
 *   withdrawn add-on;
 * - the same slug twice → rejected rather than silently billed twice, which is
 *   what happened before (two BookingAddOn rows, two charges, one line shown);
 * - a PER_PERSON quantity above the room's capacity → rejected: 500 catering
 *   covers for a 6-person room is an input error or an attack, never an order.
 */
export function resolveAddOnLines(
  requested: { slug: string; quantity: number }[],
  catalog: AddOnCatalogEntry[],
  context: { durationHours: number; roomCapacity: number }
): ResolvedAddOnLine[] {
  if (!requested.length) return [];

  const seen = new Set<string>();
  for (const req of requested) {
    if (seen.has(req.slug)) {
      throw new ErrorWithCode(ErrorCode.BadRequest, `Add-on "${req.slug}" was requested more than once`);
    }
    seen.add(req.slug);
  }

  const bySlug = new Map(catalog.map((a) => [a.slug, a]));

  return requested.map((req) => {
    const addOn = bySlug.get(req.slug);
    if (!addOn) {
      throw new ErrorWithCode(ErrorCode.BadRequest, `Unknown or inactive add-on "${req.slug}"`);
    }
    if (addOn.priceType === AddOnPriceType.PER_PERSON && req.quantity > context.roomCapacity) {
      throw new ErrorWithCode(
        ErrorCode.BadRequest,
        `"${addOn.name}" is priced per person and this room seats ${context.roomCapacity}`
      );
    }
    const { quantity, lineTotal } = computeAddOnLine(
      addOn.priceType,
      addOn.price,
      req.quantity,
      context.durationHours
    );
    return {
      addOnId: addOn.id,
      name: addOn.name,
      quantity,
      unitPrice: addOn.price,
      lineTotal,
      vatRate: addOn.vatRate,
    };
  });
}
