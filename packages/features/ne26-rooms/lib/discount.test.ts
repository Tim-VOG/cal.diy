import { describe, expect, it } from "vitest";
import { extendedUseDiscountPct } from "./discount";

describe("extendedUseDiscountPct", () => {
  it("derives VO's published grid", () => {
    // Suites 12 pax: 720 / 1296 / 1836
    expect(extendedUseDiscountPct(72000, 129600, 2)).toBe(10);
    expect(extendedUseDiscountPct(72000, 183600, 3)).toBe(15);
    // Meeting Room 12 pax: 420 / 756 / 1071
    expect(extendedUseDiscountPct(42000, 75600, 2)).toBe(10);
    expect(extendedUseDiscountPct(42000, 107100, 3)).toBe(15);
    // Meeting Room 6 pax: 300 / 540 / 765
    expect(extendedUseDiscountPct(30000, 54000, 2)).toBe(10);
    expect(extendedUseDiscountPct(30000, 76500, 3)).toBe(15);
  });

  it("shows nothing for a single hour", () => {
    expect(extendedUseDiscountPct(72000, 72000, 1)).toBeNull();
  });

  it("shows nothing when the longer slot carries no saving", () => {
    // A flat grid, or a premium for longer use — either way there is no discount
    // to advertise, so the badge disappears rather than showing 0% or a negative.
    expect(extendedUseDiscountPct(30000, 60000, 2)).toBeNull();
    expect(extendedUseDiscountPct(30000, 65000, 2)).toBeNull();
  });

  it("survives an unpriced room without dividing by zero", () => {
    expect(extendedUseDiscountPct(0, 0, 2)).toBeNull();
  });

  it("rounds to a whole percent", () => {
    expect(extendedUseDiscountPct(10000, 17750, 2)).toBe(11); // 11.25% -> 11
  });
});
