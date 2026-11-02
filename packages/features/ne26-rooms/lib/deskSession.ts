import { createHmac, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { eventDateOf, eventDayBounds, shiftDay } from "./deskDay";

/**
 * Desk mode: an admin session deliberately narrowed to the welcome desk.
 *
 * The tablet on the counter is signed in as an administrator, because a hostess
 * changes from day to day and issuing accounts for each of them is friction
 * nobody will keep up with during a three-day event. What makes that safe is
 * that entering desk mode LOCKS the session: while the cookie is present the
 * server refuses every admin action, whatever URL is typed. The PIN is the only
 * way back out.
 *
 * So the cookie is not a preference — it is a restriction, and it must not be
 * forgeable. Hence the signature.
 *
 * A shift ends on its own, because the name in the cookie is what the audit
 * trail records and yesterday's hostess has gone home. Ending it must never
 * mean unlocking it: an expired shift keeps the tablet shut out of the admin
 * and says so, until someone with the PIN re-arms it. The states below exist so
 * that "expired" and "never armed" can no longer be confused for one another —
 * reading them as the same thing is what used to hand the whole admin to
 * whoever was holding the tablet the next morning.
 */

export const DESK_COOKIE = "ne26_desk";

/**
 * How long the BROWSER keeps the cookie — deliberately far longer than a shift.
 *
 * The shift's own end is computed from the signed payload, and the server has
 * to be able to see an expired cookie in order to stay locked. A cookie the
 * browser had dropped would read as "this tablet was never in desk mode", which
 * is the one answer that opens the admin by itself.
 */
export const DESK_COOKIE_MAX_AGE_SECONDS = 30 * 24 * 60 * 60;

/**
 * The event-local hour at which a shift ends: 04:00, the dead of night.
 *
 * Any sensible shift of one day fits inside it, and whatever time the tablet
 * was handed over, it is locked again before the next morning — so the name on
 * the trail is always the person actually standing there.
 */
const SHIFT_END_HOUR = 4;

/** When a shift started at `startedAt` ends: the next 04:00 in Istanbul. */
export function shiftEndsAt(startedAt: Date): Date {
  const today = eventDayBounds(eventDateOf(startedAt)).fromUtc.getTime() + SHIFT_END_HOUR * 3600_000;
  if (today > startedAt.getTime()) return new Date(today);
  const tomorrow = eventDayBounds(shiftDay(eventDateOf(startedAt), 1)).fromUtc;
  return new Date(tomorrow.getTime() + SHIFT_END_HOUR * 3600_000);
}

export const DESK_PIN_LENGTH = 4;
const MAX_PIN_ATTEMPTS = 5;
const LOCK_MINUTES = 5;

export interface DeskSession {
  /** Who is on the desk right now — written to the audit trail, not authenticated. */
  hostessName: string;
  /** Epoch seconds. */
  startedAt: number;
}

function secret(): string {
  const value = process.env.NEXTAUTH_SECRET;
  if (!value) throw new Error("NEXTAUTH_SECRET is required to sign the desk session");
  return value;
}

function sign(payload: string): string {
  return createHmac("sha256", secret()).update(payload).digest("base64url");
}

export function encodeDeskSession(session: DeskSession): string {
  const payload = Buffer.from(JSON.stringify(session)).toString("base64url");
  return `${payload}.${sign(payload)}`;
}

/**
 * Read a desk cookie back, checking only that we signed it — the clock is not
 * consulted here. Anything we did not sign is not a desk cookie at all, and
 * reads as no cookie: a forged one must never be able to lock an admin out.
 */
export function decodeDeskSession(cookieValue: string | undefined): DeskSession | null {
  if (!cookieValue) return null;
  const [payload, signature] = cookieValue.split(".");
  if (!payload || !signature) return null;

  const expected = sign(payload);
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;

  try {
    const session = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as DeskSession;
    if (typeof session.hostessName !== "string" || typeof session.startedAt !== "number") return null;
    return session;
  } catch {
    return null;
  }
}

/**
 * What this tablet is: not in desk mode at all, working a shift, or holding a
 * shift that has ended. The third is the one that matters — it is still a desk
 * tablet, it just cannot do anything until the PIN re-arms it.
 */
export type DeskState =
  | { kind: "none" }
  | { kind: "active"; session: DeskSession; endsAt: Date }
  | { kind: "expired"; session: DeskSession; endsAt: Date };

export function deskState(cookieValue: string | undefined, now = new Date()): DeskState {
  const session = decodeDeskSession(cookieValue);
  if (!session) return { kind: "none" };
  const endsAt = shiftEndsAt(new Date(session.startedAt * 1000));
  return { kind: now.getTime() < endsAt.getTime() ? "active" : "expired", session, endsAt };
}

/** Read the desk state straight from a Cookie header. */
export function deskStateFromCookieHeader(header: string | null | undefined, now = new Date()): DeskState {
  if (!header) return { kind: "none" };
  for (const part of header.split(";")) {
    const [name, ...rest] = part.trim().split("=");
    if (name === DESK_COOKIE) return deskState(decodeURIComponent(rest.join("=")), now);
  }
  return { kind: "none" };
}

/**
 * Whether this tablet is shut out of the admin. True for a shift that has
 * ended as well as one in progress: a lock that opens by running out of time
 * is not a lock. Only the PIN clears it.
 */
export function deskBlocksAdmin(state: DeskState): boolean {
  return state.kind !== "none";
}

/** The hostess to credit for an action, or null when this is not a desk tablet. */
export function actingHostess(state: DeskState): string | null {
  return state.kind === "none" ? null : state.session.hostessName;
}

export function isValidPin(pin: string): boolean {
  return new RegExp(`^\\d{${DESK_PIN_LENGTH}}$`).test(pin);
}

export function hashPin(pin: string): string {
  const salt = randomBytes(16).toString("hex");
  return `${salt}:${scryptSync(pin, salt, 32).toString("hex")}`;
}

export function verifyPin(pin: string, stored: string | null | undefined): boolean {
  if (!stored) return false;
  const [salt, expected] = stored.split(":");
  if (!salt || !expected) return false;
  const actual = scryptSync(pin, salt, 32).toString("hex");
  const a = Buffer.from(actual);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export interface PinLockState {
  failedAttempts: number;
  lockedUntil: Date | null;
}

/** Whether the exit is currently refusing attempts, and for how much longer. */
export function pinLockRemainingMs(state: PinLockState, now = new Date()): number {
  if (!state.lockedUntil) return 0;
  return Math.max(0, state.lockedUntil.getTime() - now.getTime());
}

/** What to store after a wrong PIN. */
export function nextLockState(state: PinLockState, now = new Date()): PinLockState {
  const failedAttempts = state.failedAttempts + 1;
  if (failedAttempts < MAX_PIN_ATTEMPTS) return { failedAttempts, lockedUntil: null };
  return {
    failedAttempts: 0,
    lockedUntil: new Date(now.getTime() + LOCK_MINUTES * 60 * 1000),
  };
}
