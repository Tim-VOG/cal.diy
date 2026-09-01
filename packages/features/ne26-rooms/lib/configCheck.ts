/**
 * Deployment checks for the NE26 rooms app.
 *
 * Every problem listed here is silent in normal use and only shows itself once
 * money has moved: a webhook secret that was never set means Stripe captures the
 * payment and our confirmation never runs; test keys mean the "sales" were never
 * real; an unmounted invoice directory means the legal documents are inside the
 * container and vanish at the next deploy.
 *
 * Deliberately reported rather than thrown. Asserting at boot would take a live
 * site down over a warning, and the person who can fix any of this is looking at
 * the admin dashboard.
 */

export type ConfigIssueLevel = "error" | "warning";

export interface ConfigIssue {
  level: ConfigIssueLevel;
  /** The environment variable at fault, for the person editing .env. */
  key: string;
  title: string;
  detail: string;
}

export interface ConfigEnv {
  STRIPE_PRIVATE_KEY?: string;
  STRIPE_WEBHOOK_SECRET_NE26_ROOMS?: string;
  NE26_INVOICE_DIR?: string;
  NE26_EMAIL_REDIRECT_TO?: string;
  EMAIL_FROM?: string;
  EMAIL_SERVER_HOST?: string;
  CALENDSO_ENCRYPTION_KEY?: string;
}

/**
 * The admin-editable side of the configuration, which env alone cannot see.
 * Optional so a caller with no database handy still gets the env checks.
 */
export interface ConfigSettings {
  notifyEmails?: string | null;
  contactEmail?: string | null;
}

const CALENDSO_KEY_LENGTH = 32;

function isSet(value: string | undefined): value is string {
  return Boolean(value?.trim());
}

export function checkNe26Config(env: ConfigEnv, settings?: ConfigSettings): ConfigIssue[] {
  const issues: ConfigIssue[] = [];

  // Alerts — a sale, a failed payment, a payment with no matching order — go to
  // this list. With it empty they fall back to the contact address and then to
  // EMAIL_FROM, which is usually a no-reply nobody opens: the alert is sent and
  // still never read. A webhook outage went unnoticed for four days that way.
  if (settings && !isSet(settings.notifyEmails ?? undefined)) {
    const fallback = isSet(settings.contactEmail ?? undefined)
      ? `the contact address (${settings.contactEmail})`
      : `EMAIL_FROM (${env.EMAIL_FROM ?? "unset"})`;
    issues.push({
      level: "warning",
      key: "notifyEmails",
      title: "No one is listed for sales and failure alerts",
      detail: `Alerts fall back to ${fallback}. Set the notification addresses in Settings so a sale, a declined payment or an unmatched payment reaches someone who acts on it.`,
    });
  }

  if (!isSet(env.STRIPE_PRIVATE_KEY)) {
    issues.push({
      level: "error",
      key: "STRIPE_PRIVATE_KEY",
      title: "Stripe is not configured",
      detail: "No payment can be taken. Checkout fails as soon as an exhibitor tries to pay.",
    });
  } else if (env.STRIPE_PRIVATE_KEY.startsWith("sk_test_")) {
    issues.push({
      level: "warning",
      key: "STRIPE_PRIVATE_KEY",
      title: "Stripe is in test mode",
      detail:
        "Bookings will look successful but no money is taken and the cards are not real. Switch to the live key before opening sales.",
    });
  }

  if (!isSet(env.STRIPE_WEBHOOK_SECRET_NE26_ROOMS)) {
    issues.push({
      level: "error",
      key: "STRIPE_WEBHOOK_SECRET_NE26_ROOMS",
      title: "Stripe webhook secret missing",
      detail:
        "Payments are captured but every webhook is rejected, so bookings stay PENDING, no invoice is issued and the room is released while the buyer has paid.",
    });
  }

  if (!isSet(env.NE26_INVOICE_DIR)) {
    issues.push({
      level: "error",
      key: "NE26_INVOICE_DIR",
      title: "Invoices are not stored on a mounted volume",
      detail:
        "Invoice PDFs are being written inside the container and are lost at the next deploy. These are accounting documents.",
    });
  }

  if (isSet(env.NE26_EMAIL_REDIRECT_TO)) {
    issues.push({
      level: "warning",
      key: "NE26_EMAIL_REDIRECT_TO",
      title: `All email is being diverted to ${env.NE26_EMAIL_REDIRECT_TO}`,
      detail:
        "No exhibitor receives their invoice or calendar invite, and no sales notification reaches the team. Clear this before opening sales.",
    });
  }

  if (!isSet(env.EMAIL_FROM) || !isSet(env.EMAIL_SERVER_HOST)) {
    issues.push({
      level: "error",
      key: "EMAIL_FROM / EMAIL_SERVER_HOST",
      title: "Outgoing email is not configured",
      detail: "Buyers get no invoice and no calendar invite, and the team gets no sale notification.",
    });
  }

  if (isSet(env.CALENDSO_ENCRYPTION_KEY) && env.CALENDSO_ENCRYPTION_KEY.length !== CALENDSO_KEY_LENGTH) {
    issues.push({
      level: "error",
      key: "CALENDSO_ENCRYPTION_KEY",
      title: `Encryption key is ${env.CALENDSO_ENCRYPTION_KEY.length} characters, not ${CALENDSO_KEY_LENGTH}`,
      detail: "Anything already encrypted with a different key becomes unreadable. Do not rotate this in place.",
    });
  }

  return issues;
}

/** Read the checks against the running process. */
export function checkNe26ConfigFromProcess(settings?: ConfigSettings): ConfigIssue[] {
  return checkNe26Config(process.env as ConfigEnv, settings);
}
