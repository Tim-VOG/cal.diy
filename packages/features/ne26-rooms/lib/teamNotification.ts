/**
 * Plain-text notifications sent to the NE26 team (sales + admin) when money
 * moves. Kept pure so the wording and — above all — the amounts can be asserted
 * in unit tests: the first version of these mails printed Stripe's raw minor
 * units, so a 871.20 EUR sale was announced to the sales team as "87120 EUR".
 */

/** Minor units -> "871.20 EUR". Never hand raw cents to a human. */
export function formatMoney(minorUnits: number, currency: string): string {
  return `${(minorUnits / 100).toFixed(2)} ${currency.toUpperCase()}`;
}

/** Brussels-time slot label, e.g. "Tue 17 Nov 2026, 14:00-16:00 (Europe/Brussels)". */
export function formatSlotRange(start: Date, end: Date): string {
  const day = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Brussels",
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(start);
  const time = (d: Date) =>
    new Intl.DateTimeFormat("en-GB", {
      timeZone: "Europe/Brussels",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).format(d);
  return `${day}, ${time(start)}-${time(end)} (Europe/Brussels)`;
}

export interface SaleNotificationInput {
  bookingUid: string;
  roomName: string;
  startUtc: Date;
  endUtc: Date;
  durationMinutes: number;
  bookerName?: string | null;
  bookerEmail?: string | null;
  bookerCountry?: string | null;
  bookerVatNumber?: string | null;
  addOns: { name: string; quantity: number; lineTotal: number }[];
  /** Order total excl. VAT, as stored on the booking. */
  amountHt: number;
  /** What Stripe actually captured (incl. VAT). Null if the event carried none. */
  amountPaid?: number | null;
  currency: string;
  invoiceNumber?: string | null;
  /** Absolute link to the admin dashboard — a relative path is unclickable in a mail client. */
  adminUrl: string;
}

const LABEL_WIDTH = 18;

function field(label: string, value: string): string {
  return `${`${label}:`.padEnd(LABEL_WIDTH)}${value}`;
}

/**
 * The "a room just sold" mail. Everything the sales desk needs to recognise the
 * order without opening the dashboard: which room, when, who, how much.
 */
export function saleNotification(input: SaleNotificationInput): { subject: string; body: string } {
  const hours = input.durationMinutes / 60;
  const paid = input.amountPaid ?? null;
  const buyer = input.bookerName?.trim() || "An exhibitor";

  const subject = `Room sold — ${input.roomName}, ${hours}h${
    paid === null ? "" : ` (${formatMoney(paid, input.currency)})`
  }`;

  const lines = [
    `${input.roomName} — ${hours}h`,
    formatSlotRange(input.startUtc, input.endUtc),
    "",
    field("Buyer", input.bookerEmail ? `${buyer} <${input.bookerEmail}>` : buyer),
  ];

  if (input.bookerCountry || input.bookerVatNumber) {
    lines.push(
      field("VAT", [input.bookerVatNumber, input.bookerCountry].filter(Boolean).join(" · ") || "-")
    );
  }

  if (input.addOns.length) {
    lines.push("", "Add-ons:");
    for (const addOn of input.addOns) {
      const name = addOn.quantity > 1 ? `${addOn.name} x ${addOn.quantity}` : addOn.name;
      lines.push(`  ${name} — ${formatMoney(addOn.lineTotal, input.currency)}`);
    }
  }

  lines.push("", field("Total excl. VAT", formatMoney(input.amountHt, input.currency)));
  if (paid !== null) lines.push(field("Paid (incl. VAT)", formatMoney(paid, input.currency)));
  if (input.invoiceNumber) lines.push(field("Invoice", input.invoiceNumber));

  lines.push("", field("Booking", input.bookingUid), "", input.adminUrl);

  return { subject, body: lines.join("\n") };
}
