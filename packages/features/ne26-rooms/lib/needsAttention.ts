/**
 * What on the bookings dashboard needs a person, most expensive first.
 *
 * These were four separate panels of equal weight — deployment checks, paid
 * orders holding no room, abandoned checkouts, and nothing at all for a paid
 * order whose invoice never came out — above a table the eye went to instead.
 * Every one of them is described in this codebase as something discovered too
 * late. One list, ordered by what it costs to leave it, puts them where they
 * are seen.
 *
 * The order is deliberate:
 *   critical  money captured with no room; a configuration that breaks sales
 *   warning   a hold about to lapse; a paid order with no invoice; a config
 *             problem that does not stop a sale
 *   info      holds still running; checkouts abandoned without payment
 *
 * Pure, so the ranking can be tested; the page supplies `now`.
 */

export type AttentionSeverity = "critical" | "warning" | "info";

export type AttentionKind =
  | "paid-no-room"
  | "config"
  | "hold-expiring"
  | "invoice-missing"
  | "holds-running"
  | "abandoned";

export interface AttentionItem {
  /** Stable React key. */
  id: string;
  severity: AttentionSeverity;
  kind: AttentionKind;
  title: string;
  detail: string;
  /** Where the fix happens, when it happens on a page of ours. */
  href?: string;
  actionLabel?: string;
  /** For a hold: when it lapses, so the page can count down live. */
  expiresAt?: string;
}

export interface AttentionInput {
  now: Date;
  orphanOrders: {
    uid: string;
    bookerName: string;
    amountTotal: number;
    currency: string;
    stripePaymentId: string | null;
  }[];
  bookings: {
    orderUid: string | null;
    status: string;
    roomName: string;
    bookerName: string;
    amountTotal: number;
    currency: string;
    invoiceNumber: string | null;
    holdExpiresAt: string | null;
  }[];
  configIssues: { key: string; level: "error" | "warning"; title: string; detail: string }[];
}

/** A hold this close to lapsing is worth a call to the buyer. */
export const HOLD_WARNING_MINUTES = 10;

const SEVERITY_RANK: Record<AttentionSeverity, number> = { critical: 0, warning: 1, info: 2 };
const KIND_RANK: Record<AttentionKind, number> = {
  "paid-no-room": 0,
  config: 1,
  "hold-expiring": 2,
  "invoice-missing": 3,
  "holds-running": 4,
  abandoned: 5,
};

function money(cents: number, currency: string): string {
  return new Intl.NumberFormat("en-GB", { style: "currency", currency }).format(cents / 100);
}

export function needsAttention(input: AttentionInput): AttentionItem[] {
  const { now } = input;
  const items: AttentionItem[] = [];

  for (const o of input.orphanOrders) {
    if (!o.stripePaymentId) continue;
    items.push({
      id: `paid-no-room:${o.uid}`,
      severity: "critical",
      kind: "paid-no-room",
      title: "Paid, but holds no room",
      detail: `${o.bookerName} · ${money(o.amountTotal, o.currency)} — refund in Stripe, then close the order.`,
      href: `/rooms/admin/order/${o.uid}`,
      actionLabel: "Open order",
    });
  }

  for (const issue of input.configIssues) {
    items.push({
      id: `config:${issue.key}`,
      severity: issue.level === "error" ? "critical" : "warning",
      kind: "config",
      title: issue.title,
      detail: issue.detail,
    });
  }

  // Rooms are rows; holds and invoices belong to orders. Group so an order of
  // three rooms is one item, not three.
  const orders = new Map<string, AttentionInput["bookings"]>();
  for (const b of input.bookings) {
    if (!b.orderUid) continue;
    const list = orders.get(b.orderUid) ?? [];
    list.push(b);
    orders.set(b.orderUid, list);
  }

  const runningHolds: { name: string; expiresAt: string }[] = [];
  for (const [uid, rooms] of Array.from(orders.entries())) {
    const first = rooms[0];
    const total = rooms.reduce((sum, r) => sum + r.amountTotal, 0);
    const what = rooms.length === 1 ? first.roomName : `${rooms.length} rooms`;

    const held = rooms.find((r) => r.status === "PENDING" && r.holdExpiresAt);
    if (held?.holdExpiresAt) {
      const msLeft = new Date(held.holdExpiresAt).getTime() - now.getTime();
      if (msLeft <= 0) continue; // lapsed: the next listing removes it
      if (msLeft <= HOLD_WARNING_MINUTES * 60 * 1000) {
        items.push({
          id: `hold-expiring:${uid}`,
          severity: "warning",
          kind: "hold-expiring",
          title: "Hold about to end",
          detail: `${what} · ${first.bookerName} · ${money(total, first.currency)} — frees itself if unpaid.`,
          href: `/rooms/admin/order/${uid}`,
          actionLabel: "Open",
          expiresAt: held.holdExpiresAt,
        });
      } else {
        runningHolds.push({ name: first.bookerName, expiresAt: held.holdExpiresAt });
      }
      continue;
    }

    if (rooms.every((r) => r.status === "CONFIRMED") && !rooms.some((r) => r.invoiceNumber)) {
      items.push({
        id: `invoice-missing:${uid}`,
        severity: "warning",
        kind: "invoice-missing",
        title: "Paid, invoice missing",
        detail: `${what} · ${first.bookerName} · ${money(total, first.currency)}`,
        href: `/rooms/admin/order/${uid}`,
        actionLabel: "Issue the missing invoice",
      });
    }
  }

  if (runningHolds.length) {
    runningHolds.sort((a, b) => a.expiresAt.localeCompare(b.expiresAt));
    items.push({
      id: "holds-running",
      severity: "info",
      kind: "holds-running",
      title: runningHolds.length === 1 ? "1 more hold running" : `${runningHolds.length} more holds running`,
      detail: runningHolds.map((h) => h.name).join(" · "),
      expiresAt: runningHolds[0].expiresAt,
    });
  }

  const abandoned = input.orphanOrders.filter((o) => !o.stripePaymentId);
  if (abandoned.length) {
    items.push({
      id: "abandoned",
      severity: "info",
      kind: "abandoned",
      title:
        abandoned.length === 1
          ? "1 abandoned checkout took no money"
          : `${abandoned.length} abandoned checkouts took no money`,
      detail: "They hold no rooms. Close them when convenient.",
      href: `/rooms/admin/order/${abandoned[0].uid}`,
      actionLabel: "Review",
    });
  }

  return items.sort(
    (a, b) =>
      SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] ||
      KIND_RANK[a.kind] - KIND_RANK[b.kind] ||
      (a.expiresAt ?? "").localeCompare(b.expiresAt ?? "")
  );
}

/** How many items should light the counter in the navigation: the non-info ones. */
export function attentionCount(items: AttentionItem[]): number {
  return items.filter((i) => i.severity !== "info").length;
}
