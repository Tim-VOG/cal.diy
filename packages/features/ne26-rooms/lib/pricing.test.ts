import { AddOnPriceType } from "@calcom/prisma/enums";
import { describe, expect, it } from "vitest";
import { ErrorCode } from "@calcom/lib/errorCodes";

import { type AddOnCatalogEntry, computeAddOnLine, resolveAddOnLines } from "./pricing";

describe("computeAddOnLine", () => {
  it("FLAT ignores quantity and duration", () => {
    expect(computeAddOnLine(AddOnPriceType.FLAT, 5000, 4, 3)).toEqual({ quantity: 1, lineTotal: 5000 });
  });

  it("PER_PERSON multiplies by the requested quantity", () => {
    expect(computeAddOnLine(AddOnPriceType.PER_PERSON, 3500, 6, 2)).toEqual({
      quantity: 6,
      lineTotal: 21000,
    });
  });

  it("PER_PERSON floors to at least 1", () => {
    expect(computeAddOnLine(AddOnPriceType.PER_PERSON, 3500, 0, 1)).toEqual({ quantity: 1, lineTotal: 3500 });
  });

  it("PER_HOUR multiplies by the booking duration", () => {
    expect(computeAddOnLine(AddOnPriceType.PER_HOUR, 4000, 1, 3)).toEqual({ quantity: 3, lineTotal: 12000 });
  });
});

describe("resolveAddOnLines", () => {
  const CATERING: AddOnCatalogEntry = {
    id: 1,
    slug: "catering-lunch",
    name: "Catering - Lunch",
    price: 3500,
    priceType: AddOnPriceType.PER_PERSON,
    vatRate: 1200,
  };
  const SCREEN: AddOnCatalogEntry = {
    id: 2,
    slug: "av-screen",
    name: "AV Screen",
    price: 5000,
    priceType: AddOnPriceType.FLAT,
    vatRate: 2100,
  };
  const catalog = [CATERING, SCREEN];
  const context = { durationHours: 2, roomCapacity: 6 };

  it("prices each add-on and freezes its unit price and VAT rate", () => {
    expect(
      resolveAddOnLines([{ slug: "catering-lunch", quantity: 6 }], catalog, context)
    ).toEqual([
      { addOnId: 1, name: "Catering - Lunch", quantity: 6, unitPrice: 3500, lineTotal: 21000, vatRate: 1200 },
    ]);
  });

  it("rejects an unknown or deactivated add-on", () => {
    // A page left open can still offer an add-on the admin has since withdrawn.
    expect(() => resolveAddOnLines([{ slug: "gone", quantity: 1 }], catalog, context)).toThrowError(
      expect.objectContaining({ code: ErrorCode.BadRequest })
    );
  });

  it("rejects the same add-on twice instead of billing it twice", () => {
    // Previously this created two BookingAddOn rows and charged twice while the
    // summary showed one line.
    expect(() =>
      resolveAddOnLines(
        [
          { slug: "catering-lunch", quantity: 2 },
          { slug: "catering-lunch", quantity: 2 },
        ],
        catalog,
        context
      )
    ).toThrowError(expect.objectContaining({ code: ErrorCode.BadRequest }));
  });

  it("rejects a per-person quantity above the room capacity", () => {
    // 500 covers for a 6-person room is an input error or an attack, and it used
    // to build a real six-figure Stripe session.
    expect(() =>
      resolveAddOnLines([{ slug: "catering-lunch", quantity: 500 }], catalog, context)
    ).toThrowError(expect.objectContaining({ code: ErrorCode.BadRequest }));
  });

  it("allows a per-person quantity exactly at capacity", () => {
    expect(resolveAddOnLines([{ slug: "catering-lunch", quantity: 6 }], catalog, context)[0].quantity).toBe(6);
  });

  it("does not cap a FLAT add-on against capacity", () => {
    // Capacity bounds covers, not equipment.
    expect(
      resolveAddOnLines([{ slug: "av-screen", quantity: 99 }], catalog, context)[0]
    ).toMatchObject({ quantity: 1, lineTotal: 5000 });
  });
});
