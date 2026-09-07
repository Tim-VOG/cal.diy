/**
 * What the signup form demands of a password, in words a human can act on.
 *
 * Cal states the rules as flags — `caplow`, `num`, `min` — and the signup schema
 * raises a Zod issue whose message is the flag name itself. That is fine inside
 * the codebase and useless in front of an exhibitor: the API turned the whole
 * thing into "Internal server error", and the hint under the field listed a
 * number and a capital but never mentioned that a lowercase letter is required
 * too. So a password that satisfied everything the screen asked for was refused
 * as a server fault, with nothing to correct.
 *
 * One list, used by the form before it submits and by the route when it
 * refuses, so the two can never drift apart again.
 */

import { isPasswordValid } from "@calcom/lib/auth/isPasswordValid";

/**
 * Rule flag -> the requirement it stands for, phrased to be read after "needs".
 *
 * Declaration order is the order the sentence is built in — length, then
 * letters, then digits — so the message reads the same whether it was assembled
 * from a live check in the browser or from the schema's issues on the server.
 */
const REQUIREMENTS: [rule: string, requirement: string][] = [
  ["min", "at least 7 characters"],
  ["admin_min", "at least 15 characters"],
  ["caplow", "an uppercase and a lowercase letter"],
  ["num", "a number"],
];

/** The complete rule in one line, for anywhere too small for the checklist. */
export const PASSWORD_HINT =
  "At least 7 characters, with an uppercase letter, a lowercase letter and a number.";

export interface PasswordCheck {
  label: string;
  met: boolean;
}

/**
 * The rules as a list that ticks itself off while the visitor types.
 *
 * Split where Cal combines: `caplow` is one flag for "has a capital AND a
 * lowercase", which is exactly the pair a person gets wrong one half of. Told
 * as a single line it reads as satisfied by either.
 *
 * These conditions are written out rather than read from isPasswordValid, which
 * does not expose the halves — so a test holds the two together: every password
 * this list calls complete must be one isPasswordValid accepts, and no other.
 */
export function passwordChecklist(password: string): PasswordCheck[] {
  return [
    { label: "7 characters or more", met: password.length >= 7 },
    { label: "An uppercase letter", met: /[A-Z]/.test(password) },
    { label: "A lowercase letter", met: /[a-z]/.test(password) },
    { label: "A number", met: /\d/.test(password) },
  ];
}

/** Join requirements the way a person would say them. */
function sentence(parts: string[]): string {
  if (parts.length === 0) return "";
  if (parts.length === 1) return parts[0];
  return `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
}

/**
 * What is wrong with this password, or null when nothing is.
 *
 * Checked in the browser so the answer arrives while the field is still in
 * focus, instead of after a round trip that used to come back as a 500.
 */
export function passwordProblem(password: string): string | null {
  const result = isPasswordValid(password, true, false) as Record<string, boolean>;
  const missing = REQUIREMENTS.filter(([rule]) => rule in result && !result[rule]).map(
    ([, requirement]) => requirement
  );
  return missing.length ? `Your password needs ${sentence(missing)}.` : null;
}

interface Issue {
  path: (string | number)[];
  message?: string;
}

/**
 * Turn the signup schema's issues into one sentence.
 *
 * The password issues arrive as ["password", "<rule>"]; anything else is
 * reported by its own message, which for the email is already readable.
 * Returns null when the issues are not ones this knows how to phrase, so the
 * caller falls back rather than showing an empty complaint.
 */
export function signupIssueMessage(issues: Issue[]): string | null {
  const failed = new Set(
    issues.filter((i) => i.path[0] === "password").map((i) => String(i.path[1] ?? ""))
  );
  const missing = REQUIREMENTS.filter(([rule]) => failed.has(rule)).map(([, requirement]) => requirement);
  if (missing.length) return `Your password needs ${sentence(missing)}.`;

  const other = issues.find((i) => i.message && i.message !== i.path[i.path.length - 1]);
  return other?.message ?? null;
}
