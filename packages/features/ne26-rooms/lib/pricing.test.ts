import { AddOnPriceType } from "@calcom/prisma/enums";
import { describe, expect, it } from "vitest";
import { ErrorCode } from "@calcom/lib/errorCodes";

import {
  type AddOnCatalogEntry,
  computeAddOnLine,
  formatAddOnWindow,
  isAddOnOfferedDuring,
  minimumCoversFor,
  resolveAddOnLines,
} from "./pricing";

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

describe("serving windows", () => {
  // The complaint that started this: a 09:00 booking was still offered lunch.
  const LUNCH = { availableFromMinute: 660, availableToMinute: 840 }; // 11:00-14:00
  const at = (startHour: number, hours: number) => ({
    startMinute: startHour * 60,
    endMinute: (startHour + hours) * 60,
  });

  describe("isAddOnOfferedDuring", () => {
    it("offers it to a booking sitting inside the window", () => {
      expect(isAddOnOfferedDuring(LUNCH, at(12, 1))).toBe(true);
    });

    it("offers it to a booking that runs INTO the window", () => {
      // 10:00-12:00 reaches lunch service. Requiring the booking to sit wholly
      // inside would refuse most 2h and 3h bookings — the ones most likely to
      // want catering in the first place.
      expect(isAddOnOfferedDuring(LUNCH, at(10, 2))).toBe(true);
    });

    it("offers it to a booking that starts inside and runs past the end", () => {
      expect(isAddOnOfferedDuring(LUNCH, at(13, 3))).toBe(true);
    });

    it("refuses a booking that ends exactly when service starts", () => {
      // 09:00-11:00 is over before the first cover is served.
      expect(isAddOnOfferedDuring(LUNCH, at(9, 2))).toBe(false);
    });

    it("refuses a booking that starts exactly when service ends", () => {
      expect(isAddOnOfferedDuring(LUNCH, at(14, 1))).toBe(false);
    });

    it("refuses the 09:00 booking from the feedback", () => {
      expect(isAddOnOfferedDuring(LUNCH, at(9, 1))).toBe(false);
    });

    it("always offers an add-on with no window", () => {
      expect(isAddOnOfferedDuring({}, at(9, 1))).toBe(true);
      expect(isAddOnOfferedDuring({ availableFromMinute: null, availableToMinute: null }, at(9, 1))).toBe(
        true
      );
    });

    it("fails open on a half-configured window", () => {
      // An admin who filled one field and not the other must not silently stop
      // the add-on being sold.
      expect(isAddOnOfferedDuring({ availableFromMinute: 660, availableToMinute: null }, at(9, 1))).toBe(
        true
      );
    });
  });

  describe("resolveAddOnLines", () => {
    const LUNCH_ENTRY: AddOnCatalogEntry = {
      id: 1,
      slug: "catering-lunch",
      name: "Catering - Lunch",
      price: 3500,
      priceType: AddOnPriceType.PER_PERSON,
      vatRate: 1200,
      ...LUNCH,
    };

    it("refuses lunch on a 09:00 booking, naming the hours", () => {
      expect(() =>
        resolveAddOnLines([{ slug: "catering-lunch", quantity: 4 }], [LUNCH_ENTRY], {
          durationHours: 1,
          roomCapacity: 6,
          slot: at(9, 1),
        })
      ).toThrowError(/only served between 11:00-14:00/);
    });

    it("sells it at 12:00", () => {
      const [line] = resolveAddOnLines([{ slug: "catering-lunch", quantity: 4 }], [LUNCH_ENTRY], {
        durationHours: 1,
        roomCapacity: 6,
        slot: at(12, 1),
      });
      expect(line.lineTotal).toBe(14000);
    });

    it("skips the check when no slot is supplied", () => {
      // Callers that genuinely have no time of day (an admin re-pricing) must
      // not be broken by a window.
      expect(
        resolveAddOnLines([{ slug: "catering-lunch", quantity: 4 }], [LUNCH_ENTRY], {
          durationHours: 1,
          roomCapacity: 6,
        })
      ).toHaveLength(1);
    });
  });

  describe("formatAddOnWindow", () => {
    it("reads as a time range", () => {
      expect(formatAddOnWindow(660, 840)).toBe("11:00-14:00");
      expect(formatAddOnWindow(690, 845)).toBe("11:30-14:05");
    });
  });
});

describe("minimum covers", () => {
  // The caterer will not serve a table of two, and the floor rises with the
  // room: a suite seats more, so it starts at six.
  const LUNCH: AddOnCatalogEntry = {
    id: 1,
    slug: "catering-lunch",
    name: "Lunch",
    price: 3300,
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

  it("is 6 in a Premium suite and 4 everywhere else", () => {
    expect(minimumCoversFor("PREMIUM")).toBe(6);
    expect(minimumCoversFor("INTERMEDIATE")).toBe(4);
    expect(minimumCoversFor("ENTRY")).toBe(4);
  });

  it("refuses four covers in a suite, naming the minimum", () => {
    expect(() =>
      resolveAddOnLines([{ slug: "catering-lunch", quantity: 4 }], [LUNCH], {
        durationHours: 1,
        roomCapacity: 24,
        roomCategory: "PREMIUM",
      })
    ).toThrowError(/minimum of 6 people/);
  });

  it("accepts four covers in an entry room", () => {
    const [line] = resolveAddOnLines([{ slug: "catering-lunch", quantity: 4 }], [LUNCH], {
      durationHours: 1,
      roomCapacity: 6,
      roomCategory: "ENTRY",
    });
    expect(line.lineTotal).toBe(13200);
  });

  it("still refuses more covers than the room seats", () => {
    expect(() =>
      resolveAddOnLines([{ slug: "catering-lunch", quantity: 9 }], [LUNCH], {
        durationHours: 1,
        roomCapacity: 6,
        roomCategory: "ENTRY",
      })
    ).toThrowError(/seats 6/);
  });

  it("does not apply to a flat-priced add-on", () => {
    // One screen is one screen; there is no minimum number of people for it.
    expect(
      resolveAddOnLines([{ slug: "av-screen", quantity: 1 }], [SCREEN], {
        durationHours: 1,
        roomCapacity: 24,
        roomCategory: "PREMIUM",
      })
    ).toHaveLength(1);
  });

  it("skips the check when the caller has no category to judge by", () => {
    expect(
      resolveAddOnLines([{ slug: "catering-lunch", quantity: 2 }], [LUNCH], {
        durationHours: 1,
        roomCapacity: 6,
      })
    ).toHaveLength(1);
  });
});
