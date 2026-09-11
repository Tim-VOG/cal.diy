/**
 * Who each kind of team mail is actually for.
 *
 * Everything the team received used to go to one list, so the sales desk got
 * "Payment captured with no matching order" next to "Room sold". Those are two
 * different jobs: one is a sale to follow up, the other is a reconciliation
 * nobody on sales can act on, and mixing them is how the ones that matter stop
 * being read.
 *
 * The split:
 *
 *   sales -> a booking changed hands (sold, declined, refunded). Goes to the
 *            sales list, with the technical address in copy so it keeps the
 *            full picture.
 *   ops   -> something needs a human with database or Stripe access (two
 *            payments for one order, a capture with no rooms, a partial
 *            refund). Technical address only.
 *
 * Pure, because the interesting part is the fallbacks. A notification with
 * nowhere to go is the one failure this must not have — during a three-day
 * event, a log line nobody reads is the same as silence — so every audience
 * walks a chain of alternatives and only gives up when the settings are empty
 * from end to end.
 */

export type NotificationAudience = "sales" | "ops";

export interface NotificationSettings {
  /** The sales list, comma-separated. Admin-editable. */
  notifyEmails?: string | null;
  /** Where the operational alerts go. Admin-editable. */
  technicalEmails?: string | null;
  /** The public contact address; a last resort rather than a destination. */
  contactEmail?: string | null;
}

export interface Envelope {
  to: string[];
  cc: string[];
}

/**
 * Split a pasted list into addresses.
 *
 * Semicolons as well as commas: Outlook hands one out when you copy a group of
 * recipients, and an admin pasting that into the settings field should not have
 * to know which separator we happened to pick.
 */
export function parseAddressList(value: string | null | undefined): string[] {
  if (!value) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of value.split(/[,;]/)) {
    const address = raw.trim();
    if (!address) continue;
    const key = address.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(address);
  }
  return out;
}

/** The first list in the chain that actually contains an address. */
function firstNonEmpty(...candidates: (string | null | undefined)[]): string[] {
  for (const candidate of candidates) {
    const parsed = parseAddressList(candidate);
    if (parsed.length) return parsed;
  }
  return [];
}

export function routeNotification(
  audience: NotificationAudience,
  settings: NotificationSettings,
  lastResort?: string | null
): Envelope {
  const { notifyEmails, technicalEmails, contactEmail } = settings;

  if (audience === "ops") {
    // Falls back to the sales list rather than going nowhere: bothering sales
    // with a reconciliation is a nuisance, losing it is a missing payment.
    return { to: firstNonEmpty(technicalEmails, notifyEmails, contactEmail, lastResort), cc: [] };
  }

  const to = firstNonEmpty(notifyEmails, technicalEmails, contactEmail, lastResort);
  const inTo = new Set(to.map((a) => a.toLowerCase()));
  // No address is ever both a recipient and a copy — which is what happens the
  // moment the technical address is also on the sales list, or when the sales
  // list is empty and the technical one was promoted into "to" just above.
  const cc = parseAddressList(technicalEmails).filter((a) => !inTo.has(a.toLowerCase()));
  return { to, cc };
}
