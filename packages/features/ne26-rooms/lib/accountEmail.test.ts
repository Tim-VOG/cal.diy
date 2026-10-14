import { describe, expect, it } from "vitest";
import { checkNewEmail, emailRefusalMessage, normalizeEmail } from "./accountEmail";

describe("normalizeEmail", () => {
  it("lowercases and trims, because sign-in does", () => {
    // Stored with capitals, the account could never be matched at login.
    expect(normalizeEmail("  Robinah.Nayiga@Moodys.com ")).toBe("robinah.nayiga@moodys.com");
  });
});

describe("checkNewEmail", () => {
  const current = "robinah.nayoga@moodys.com";

  it("accepts a corrected address, normalised", () => {
    expect(checkNewEmail("Robinah.Nayiga@moodys.com", current, null, 39)).toEqual({
      ok: true,
      email: "robinah.nayiga@moodys.com",
    });
  });

  it("refuses an empty or malformed address", () => {
    expect(checkNewEmail("   ", current, null, 39)).toEqual({ ok: false, reason: "empty" });
    expect(checkNewEmail("robinah@", current, null, 39)).toEqual({ ok: false, reason: "malformed" });
    expect(checkNewEmail("robinah moodys.com", current, null, 39)).toEqual({
      ok: false,
      reason: "malformed",
    });
  });

  it("refuses the address it already has, whatever the case", () => {
    expect(checkNewEmail("Robinah.Nayoga@Moodys.com", current, 39, 39)).toEqual({
      ok: false,
      reason: "unchanged",
    });
  });

  it("refuses an address another account signs in with", () => {
    // Two accounts on one address makes the login ambiguous.
    expect(checkNewEmail("someone@else.com", current, 12, 39)).toEqual({ ok: false, reason: "taken" });
    // Held by this same account under a different capitalisation: not a clash.
    expect(checkNewEmail("another@moodys.com", current, 39, 39)).toEqual({
      ok: true,
      email: "another@moodys.com",
    });
  });

  it("explains each refusal in words the exhibitor can act on", () => {
    expect(emailRefusalMessage("taken")).toContain("Another account");
    expect(emailRefusalMessage("malformed")).toContain("email address");
  });
});
