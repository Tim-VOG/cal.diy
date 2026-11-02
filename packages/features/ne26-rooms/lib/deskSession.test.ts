import { beforeAll, describe, expect, it } from "vitest";
import {
  DESK_COOKIE,
  decodeDeskSession,
  deskBlocksAdmin,
  deskState,
  deskStateFromCookieHeader,
  encodeDeskSession,
  hashPin,
  isValidPin,
  nextLockState,
  pinLockRemainingMs,
  shiftEndsAt,
  verifyPin,
} from "./deskSession";

beforeAll(() => {
  process.env.NEXTAUTH_SECRET = "test-secret-for-desk-session";
});

const NOW = new Date("2026-11-17T09:00:00.000Z");
const session = { hostessName: "Amélie", startedAt: Math.floor(NOW.getTime() / 1000) };

describe("desk session cookie", () => {
  it("round-trips the hostess on duty", () => {
    expect(decodeDeskSession(encodeDeskSession(session))).toEqual(session);
  });

  it("rejects a forged cookie", () => {
    // The cookie is a restriction, not a preference: anyone able to mint one
    // could instead mint an absent one and walk straight into the admin.
    const payload = Buffer.from(JSON.stringify(session)).toString("base64url");
    expect(decodeDeskSession(`${payload}.notasignature`)).toBeNull();
  });

  it("rejects a cookie whose payload was edited after signing", () => {
    const encoded = encodeDeskSession(session);
    const [, signature] = encoded.split(".");
    const tampered = Buffer.from(JSON.stringify({ ...session, hostessName: "Someone else" })).toString(
      "base64url"
    );
    expect(decodeDeskSession(`${tampered}.${signature}`)).toBeNull();
  });

  it("rejects nonsense rather than throwing", () => {
    expect(decodeDeskSession(undefined)).toBeNull();
    expect(decodeDeskSession("")).toBeNull();
    expect(decodeDeskSession("nodot")).toBeNull();
    expect(decodeDeskSession("!!!.!!!")).toBeNull();
  });

  it("reads the cookie out of a header alongside others", () => {
    const header = `next-auth.session-token=abc; ${DESK_COOKIE}=${encodeDeskSession(session)}; other=1`;
    expect(deskStateFromCookieHeader(header, NOW)).toMatchObject({ kind: "active", session });
  });

  it("reports no desk mode when the header has no desk cookie", () => {
    expect(deskStateFromCookieHeader("next-auth.session-token=abc", NOW).kind).toBe("none");
    expect(deskStateFromCookieHeader(null, NOW).kind).toBe("none");
  });

  it("treats a cookie it did not sign as no cookie at all", () => {
    // Not as an expired one: otherwise anyone able to drop a junk cookie on the
    // tablet could lock the administrator out of their own admin.
    expect(deskState("rubbish.rubbish", NOW).kind).toBe("none");
  });
});

describe("when a shift ends", () => {
  it("ends at 04:00 Istanbul the morning after it started", () => {
    // 12:00 TRT on the 17th -> 04:00 TRT on the 18th, which is 01:00 UTC.
    expect(shiftEndsAt(new Date("2026-11-17T09:00:00.000Z")).toISOString()).toBe("2026-11-18T01:00:00.000Z");
  });

  it("ends the same morning for a tablet armed in the small hours", () => {
    // 02:00 TRT on the 17th is 23:00 UTC on the 16th: the next 04:00 is hours
    // away, not a day and a half.
    expect(shiftEndsAt(new Date("2026-11-16T23:00:00.000Z")).toISOString()).toBe("2026-11-17T01:00:00.000Z");
  });

  it("holds a whole working day, however late the handover", () => {
    const evening = new Date("2026-11-17T15:00:00.000Z"); // 18:00 TRT
    expect(shiftEndsAt(evening).getTime() - evening.getTime()).toBe(10 * 60 * 60 * 1000);
  });
});

describe("a shift that has ended", () => {
  // Signed inside each test: the secret is only in place once beforeAll has run.
  const nextMorning = new Date("2026-11-18T06:00:00.000Z");

  it("is expired, not absent", () => {
    // The whole point: "expired" and "never armed" used to be the same value,
    // and the tablet woke up on day two as a full administrator.
    const state = deskState(encodeDeskSession(session), nextMorning);
    expect(state.kind).toBe("expired");
    expect(state.kind !== "none" && state.session.hostessName).toBe("Amélie");
  });

  it("still keeps the tablet out of the admin", () => {
    const encoded = encodeDeskSession(session);
    expect(deskBlocksAdmin(deskState(encoded, nextMorning))).toBe(true);
    expect(deskBlocksAdmin(deskState(encoded, NOW))).toBe(true);
    expect(deskBlocksAdmin(deskState(undefined, NOW))).toBe(false);
  });

  it("is still active one second before 04:00, and over one second after", () => {
    const encoded = encodeDeskSession(session);
    const endsAt = shiftEndsAt(new Date(session.startedAt * 1000));
    expect(deskState(encoded, new Date(endsAt.getTime() - 1000)).kind).toBe("active");
    expect(deskState(encoded, endsAt).kind).toBe("expired");
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
