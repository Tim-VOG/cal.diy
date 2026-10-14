/**
 * Changing the address an exhibitor signs in with.
 *
 * It is one column on one row, and it reaches further than it looks: the address
 * is the login, every future mail about a booking, and the key the Bookers list
 * groups by. The rules that decide what a new address IS live here, pure, so
 * the admin form, the exhibitor's own form and the tests all agree.
 */

/**
 * Sign-in lowercases what is typed, so an address stored with capitals can
 * never be matched and the account is locked out. Normalising here is what makes
 * "Robinah.Nayiga@moodys.com" and "robinah.nayiga@moodys.com" the same account.
 */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export type EmailRefusal = "empty" | "malformed" | "unchanged" | "taken";

/** Deliberately loose: one @, something either side, no spaces. The address proves itself by being used. */
const SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Whether this address can replace that one. `takenBy` is the id of the account
 * already using it, when there is one — two accounts sharing an address would
 * make the login ambiguous and the invoices unattributable.
 */
export function checkNewEmail(
  raw: string,
  current: string,
  takenBy: number | null,
  userId: number
): { ok: true; email: string } | { ok: false; reason: EmailRefusal } {
  const email = normalizeEmail(raw);
  if (!email) return { ok: false, reason: "empty" };
  if (!SHAPE.test(email)) return { ok: false, reason: "malformed" };
  if (email === normalizeEmail(current)) return { ok: false, reason: "unchanged" };
  if (takenBy !== null && takenBy !== userId) return { ok: false, reason: "taken" };
  return { ok: true, email };
}

export function emailRefusalMessage(reason: EmailRefusal): string {
  switch (reason) {
    case "empty":
      return "An email address is required.";
    case "malformed":
      return "That does not look like an email address.";
    case "unchanged":
      return "That is already the address on this account.";
    case "taken":
      return "Another account already uses that address.";
  }
}
