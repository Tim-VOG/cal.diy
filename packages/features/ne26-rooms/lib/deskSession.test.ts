import { beforeAll, describe, expect, it } from "vitest";
import {
  DESK_COOKIE,
  decodeDeskSession,
  deskSessionFromCookieHeader,
  encodeDeskSession,
  hashPin,
  isValidPin,
  nextLockState,
  pinLockRemainingMs,
  verifyPin,
} from "./deskSession";

beforeAll(() => {
  process.env.NEXTAUTH_SECRET = "test-secret-for-desk-session";
});

const NOW = new Date("2026-11-17T09:00:00.000Z");
const session = { hostessName: "Amélie", startedAt: Math.floor(NOW.getTime() / 1000) };

describe("desk session cookie", () => {
  it("round-trips the hostess on duty", () => {
    expect(decodeDeskSession(encodeDeskSession(session), NOW)).toEqual(session);
  });

  it("rejects a forged cookie", () => {
    // The cookie is a restriction, not a preference: anyone able to mint one
    // could instead mint an absent one and walk straight into the admin.
    const payload = Buffer.from(JSON.stringify(session)).toString("base64url");
    expect(decodeDeskSession(`${payload}.notasignature`, NOW)).toBeNull();
  });

  it("rejects a cookie whose payload was edited after signing", () => {
    const encoded = encodeDeskSession(session);
    const [, signature] = encoded.split(".");
    const tampered = Buffer.from(JSON.stringify({ ...session, hostessName: "Someone else" })).toString(
      "base64url"
    );
    expect(decodeDeskSession(`${tampered}.${signature}`, NOW)).toBeNull();
  });

  it("rejects nonsense rather than throwing", () => {
    expect(decodeDeskSession(undefined, NOW)).toBeNull();
    expect(decodeDeskSession("", NOW)).toBeNull();
    expect(decodeDeskSession("nodot", NOW)).toBeNull();
    expect(decodeDeskSession("!!!.!!!", NOW)).toBeNull();
  });

  it("stops honouring a cookie once the shift is over", () => {
    const encoded = encodeDeskSession(session);
    const nextMorning = new Date(NOW.getTime() + 17 * 60 * 60 * 1000);
    expect(decodeDeskSession(encoded, nextMorning)).toBeNull();
  });

  it("reads the cookie out of a header alongside others", () => {
    const header = `next-auth.session-token=abc; ${DESK_COOKIE}=${encodeDeskSession(session)}; other=1`;
    expect(deskSessionFromCookieHeader(header, NOW)).toEqual(session);
  });

  it("returns null when the header has no desk cookie", () => {
    expect(deskSessionFromCookieHeader("next-auth.session-token=abc", NOW)).toBeNull();
    expect(deskSessionFromCookieHeader(null, NOW)).toBeNull();
  });
});

describe("desk PIN", () => {
  it("accepts only four digits", () => {
    expect(isValidPin("1234")).toBe(true);
    expect(isValidPin("0000")).toBe(true);
    expect(isValidPin("123")).toBe(false);
    expect(isValidPin("12345")).toBe(false);
    expect(isValidPin("12a4")).toBe(false);
    expect(isValidPin("")).toBe(false);
  });

  it("verifies a PIN without storing it", () => {
    const stored = hashPin("4821");
    expect(stored).not.toContain("4821");
    expect(verifyPin("4821", stored)).toBe(true);
    expect(verifyPin("4822", stored)).toBe(false);
  });

  it("salts, so the same PIN does not produce the same hash twice", () => {
    expect(hashPin("4821")).not.toBe(hashPin("4821"));
  });

  it("refuses when no PIN has been set", () => {
    // Otherwise desk mode would be exitable by anyone before the PIN is chosen.
    expect(verifyPin("4821", null)).toBe(false);
    expect(verifyPin("4821", "")).toBe(false);
    expect(verifyPin("4821", "garbage-without-a-colon")).toBe(false);
  });
});

describe("PIN attempt locking", () => {
  it("counts wrong attempts without locking straight away", () => {
    let state = { failedAttempts: 0, lockedUntil: null as Date | null };
    for (let i = 1; i < 5; i++) {
      state = nextLockState(state, NOW);
      expect(state.lockedUntil).toBeNull();
      expect(state.failedAttempts).toBe(i);
    }
  });

  it("locks the exit after five wrong attempts", () => {
    const state = nextLockState({ failedAttempts: 4, lockedUntil: null }, NOW);
    expect(state.lockedUntil).not.toBeNull();
    expect(pinLockRemainingMs(state, NOW)).toBe(5 * 60 * 1000);
    // The counter resets, so the next lock needs another five attempts.
    expect(state.failedAttempts).toBe(0);
  });

  it("reports no lock once it has expired", () => {
    const state = { failedAttempts: 0, lockedUntil: new Date(NOW.getTime() - 1000) };
    expect(pinLockRemainingMs(state, NOW)).toBe(0);
  });
});
