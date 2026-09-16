import { describe, expect, it } from "vitest";
import { orderRef } from "./orderRef";

describe("orderRef", () => {
  it("pads to four digits, like the invoice series", () => {
    expect(orderRef(1)).toBe("NE26-ORD-0001");
    expect(orderRef(42)).toBe("NE26-ORD-0042");
  });

  it("keeps growing past four digits rather than wrapping", () => {
    expect(orderRef(12345)).toBe("NE26-ORD-12345");
  });

  it("cannot be confused with an invoice or a credit note of the same number", () => {
    const ref = orderRef(1);
    expect(ref).not.toBe("NE26-2026-0001");
    expect(ref).not.toBe("NE26-CN-2026-0001");
    expect(ref).toContain("ORD");
  });
});
