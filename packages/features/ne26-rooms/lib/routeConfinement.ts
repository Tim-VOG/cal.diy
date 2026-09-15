/**
 * Where a signed-in exhibitor may go: the rooms, and nothing of Cal's.
 *
 * This installation is a room-booking site built on Cal, and all of Cal's own
 * screens are still there underneath — /event-types, /apps, /availability,
 * /settings. Nothing stopped an exhibitor who typed one of those addresses from
 * landing in a scheduling product they never signed up for, with menus that
 * lead further in. Anonymous visitors were already turned away by Cal's own
 * sign-in; signed-in ones were not.
 *
 * An ALLOWLIST, not a list of Cal screens to block. Cal has dozens of routes and
 * gains more with every upstream merge; a denylist is out of date the day after
 * it is written, and it fails open. Anything not named here sends the exhibitor
 * back to /rooms.
 *
 * This is navigation, not security. Every Cal screen still checks its own
 * permissions; what this removes is the chance of wandering in.
 */

/** Cal's two administrator roles. INACTIVE_ADMIN is an admin without 2FA. */
const UNCONFINED_ROLES = new Set(["ADMIN", "INACTIVE_ADMIN"]);

/**
 * Paths an exhibitor needs. Matched as a whole segment, so "/rooms" allows
 * "/rooms/bookings" but not "/roomsxyz".
 *
 *   /rooms  the whole NE26 app, the hostess desk included (/rooms/desk)
 *   /auth   sign-out, forgotten password, email verification — reached from
 *           the NE26 sign-in page and from the emails Cal sends
 *   /api    everything the pages call, sign-out and Stripe included
 *   /_next  the framework's own assets and data requests
 */
const ALLOWED_PREFIXES = ["/rooms", "/auth", "/api", "/_next"];

export const CONFINED_HOME = "/rooms";

export type RouteDecision = { action: "allow" } | { action: "redirect"; to: string };

export function confineRoute(input: {
  pathname: string;
  /** The role carried by the session token, or null when nobody is signed in. */
  role: string | null | undefined;
}): RouteDecision {
  const { pathname, role } = input;

  // Nobody signed in: Cal's pages already send them to a sign-in page, and the
  // public 404 must still be able to answer a mistyped address.
  if (!role) return { action: "allow" };
  if (UNCONFINED_ROLES.has(role)) return { action: "allow" };

  // The root redirects to /rooms on its own.
  if (pathname === "/" || pathname === "") return { action: "allow" };

  // Checked on the path exactly as received, never decoded first: decoding
  // "/rooms%2F..%2Fapps" into something that starts with "/rooms/" is how an
  // allowlist gets talked past. An oddly encoded path simply goes home.
  const allowed = ALLOWED_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
  return allowed ? { action: "allow" } : { action: "redirect", to: CONFINED_HOME };
}
