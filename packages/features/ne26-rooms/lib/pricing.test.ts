import { describe, expect, it } from "vitest";

import { AddOnPriceType } from "@calcom/prisma/enums";

import { computeAddOnLine } from "./pricing";

describe("computeAddOnLine", () => {
  it("FLAT ignores quantity and duration", () => {
    expect(computeAddOnLine(AddOnPriceType.FLAT, 5000, 4, 3)).toEqual({ quantity: 1, lineTotal: 5000 });
  });

  it("PER_PERSON multiplies by the requested quantity", () => {
    expect(computeAddOnLine(AddOnPriceType.PER_PERSON, 3500, 6, 2)).toEqual({ quantity: 6, lineTotal: 21000 });
  });

  it("PER_PERSON floors to at least 1", () => {
    expect(computeAddOnLine(AddOnPriceType.PER_PERSON, 3500, 0, 1)).toEqual({ quantity: 1, lineTotal: 3500 });
  });

  it("PER_HOUR multiplies by the booking duration", () => {
    expect(computeAddOnLine(AddOnPriceType.PER_HOUR, 4000, 1, 3)).toEqual({ quantity: 3, lineTotal: 12000 });
  });
});
