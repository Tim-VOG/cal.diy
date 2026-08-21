import { describe, expect, it } from "vitest";
import { canAdminister, canSellAtTheDesk, canWorkTheDesk, roleOf } from "./staff";

const exhibitor = { userId: 1, email: "buyer@example.com" };
const hostess = { userId: 2, email: "desk@vo-group.be", staffRole: "HOSTESS" as const };
const admin = { userId: 3, email: "ne26@vo-group.be", calRole: "ADMIN" };

describe("roleOf", () => {
  it("treats an account with no role as an exhibitor", () => {
    expect(roleOf(exhibitor)).toBe("EXHIBITOR");
  });

  it("reads the hostess role", () => {
    expect(roleOf(hostess)).toBe("HOSTESS");
  });

  it("lets admin win over a staff role", () => {
    // An admin who also works the desk must not lose the dashboard.
    expect(roleOf({ ...admin, staffRole: "HOSTESS" })).toBe("ADMIN");
  });

  it("does not mistake another Cal role for admin", () => {
    expect(roleOf({ ...exhibitor, calRole: "INACTIVE_ADMIN" })).toBe("EXHIBITOR");
  });
});

describe("permissions", () => {
  it("keeps exhibitors out of the desk and the dashboard", () => {
    expect(canWorkTheDesk(exhibitor)).toBe(false);
    expect(canAdminister(exhibitor)).toBe(false);
    expect(canSellAtTheDesk(exhibitor)).toBe(false);
  });

  it("lets a hostess work and sell at the desk but never administer", () => {
    expect(canWorkTheDesk(hostess)).toBe(true);
    expect(canSellAtTheDesk(hostess)).toBe(true);
    // Settings, pricing, refunds and granting roles stay out of reach.
    expect(canAdminister(hostess)).toBe(false);
  });

  it("lets an admin do everything, desk included", () => {
    expect(canWorkTheDesk(admin)).toBe(true);
    expect(canSellAtTheDesk(admin)).toBe(true);
    expect(canAdminister(admin)).toBe(true);
  });

  it("does not grant the desk on a null or unknown staff role", () => {
    expect(canWorkTheDesk({ ...exhibitor, staffRole: null })).toBe(false);
  });
});
