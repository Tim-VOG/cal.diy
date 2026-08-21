import { createHmac, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

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
 */

export const DESK_COOKIE = "ne26_desk";

/** How long one desk shift lasts before the cookie stops being honoured. */
const MAX_AGE_SECONDS = 16 * 60 * 60;

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
 * Read a desk cookie back. Returns null for anything not signed by us or past
 * its shift — and null means "not in desk mode", which fails towards the
 * unrestricted session rather than towards a lock nobody can clear.
 */
export function decodeDeskSession(cookieValue: string | undefined, now = new Date()): DeskSession | null {
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
    if (Math.floor(now.getTime() / 1000) - session.startedAt > MAX_AGE_SECONDS) return null;
    return session;
  } catch {
    return null;
  }
}

/** Read the desk session straight from a Cookie header. */
export function deskSessionFromCookieHeader(header: string | null | undefined, now = new Date()) {
  if (!header) return null;
  for (const part of header.split(";")) {
    const [name, ...rest] = part.trim().split("=");
    if (name === DESK_COOKIE) return decodeDeskSession(decodeURIComponent(rest.join("=")), now);
  }
  return null;
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
