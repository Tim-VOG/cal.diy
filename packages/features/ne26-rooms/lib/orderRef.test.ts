import { describe, expect, it } from "vitest";
import { orderRef } from "./orderRef";

describe("orderRef", () => {
  it("is the first block of the uid, so it matches the order page at a glance", () => {
    expect(orderRef("12389044-0faa-45ba-9a07-66d30989b0a8")).toBe("#12389044");
  });

  it("is the same for every room of one order", () => {
    const uid = "c5db616a-333f-4c21-b494-7f070d42f8c1";
    expect(orderRef(uid)).toBe(orderRef(uid));
    expect(orderRef(uid)).not.toBe(orderRef("27536296-5e19-4202-9fe1-8472eda39006"));
  });

  it("stays short even for a uid without dashes", () => {
    expect(orderRef("0123456789abcdef")).toBe("#01234567");
  });
});
