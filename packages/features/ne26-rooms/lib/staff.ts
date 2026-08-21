/**
 * Who may do what in the NE26 rooms app.
 *
 * Two sources, deliberately not merged: Cal's own `User.role === "ADMIN"` stays
 * the source of truth for administrators, and Ne26StaffRole only adds roles Cal
 * has no concept of. Mirroring ADMIN into our table would give two answers to
 * one question, and they would drift.
 */

export type Ne26Role = "ADMIN" | "HOSTESS" | "EXHIBITOR";

export interface StaffPrincipal {
  userId: number;
  email: string;
  /** Cal's user role. */
  calRole?: string | null;
  /** NE26 staff role, when one has been granted. */
  staffRole?: "HOSTESS" | null;
}

/**
 * The single role an account acts under. Admin wins: an administrator who is
 * also marked as a hostess must not lose access to the dashboard.
 */
export function roleOf(principal: StaffPrincipal): Ne26Role {
  if (principal.calRole === "ADMIN") return "ADMIN";
  if (principal.staffRole === "HOSTESS") return "HOSTESS";
  return "EXHIBITOR";
}

/**
 * The welcome desk. Admins are included: during the event they work the desk
 * too, and having to grant yourself a second role to do that is friction with
 * no security benefit — an admin can already do strictly more.
 */
export function canWorkTheDesk(principal: StaffPrincipal): boolean {
  const role = roleOf(principal);
  return role === "ADMIN" || role === "HOSTESS";
}

/** Settings, pricing, refunds, invoices, granting roles. Admins only. */
export function canAdminister(principal: StaffPrincipal): boolean {
  return roleOf(principal) === "ADMIN";
}

/**
 * Whether this principal may sell a room to someone standing at the desk.
 *
 * The hostess never handles a card: she configures the booking and the exhibitor
 * pays on their own phone from a link. So "selling" here is only the right to
 * create a held booking and issue that link — not to take money, and not to
 * alter one already paid.
 */
export function canSellAtTheDesk(principal: StaffPrincipal): boolean {
  return canWorkTheDesk(principal);
}
