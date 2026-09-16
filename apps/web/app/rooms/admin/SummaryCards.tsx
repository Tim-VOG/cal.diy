"use client";

import { fmtHours, fmtMoment, fmtMoney } from "./format";
import type { AdminBookingRow } from "./RoomsAdminView";
import { Card, Eyebrow, HATCH } from "./ui";

/**
 * Money and occupancy at a glance, and the last orders to come in.
 *
 * "Confirmed sales", not "collected": the figure counts every confirmed booking,
 * including an order marked paid by hand after a bank transfer. Calling it
 * collected would claim Stripe had it.
 */
export default function SummaryCards({
  rows,
  soldHours,
  heldHours,
  capacityHours,
}: {
  rows: AdminBookingRow[];
  soldHours: number;
  heldHours: number;
  capacityHours: number;
}): JSX.Element {
  const currency = rows[0]?.currency ?? "EUR";
  const confirmed = rows.filter((r) => r.status === "CONFIRMED");
  const sales = confirmed.reduce((sum, r) => sum + r.amountTotal, 0);
  const awaiting = rows.filter((r) => r.status === "PENDING").reduce((sum, r) => sum + r.amountTotal, 0);
  const invoices = new Set(rows.filter((r) => r.invoiceNumber).map((r) => r.invoiceNumber)).size;
  const creditNotes = new Set(rows.filter((r) => r.creditNoteNumber).map((r) => r.creditNoteNumber)).size;

  // Latest orders, one line per order rather than per room.
  const seen = new Set<string>();
  const latest = [...rows]
    .sort((a, b) => b.orderedAt.localeCompare(a.orderedAt))
    .filter((r) => {
      const key = r.orderUid ?? r.uid;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, 4);

  const pct = (h: number) => (capacityHours > 0 ? Math.min(100, (h / capacityHours) * 100) : 0);

  return (
    <div className="grid gap-4">
      <Card className="p-4">
        <Eyebrow>Confirmed sales</Eyebrow>
        <p className="mt-1 font-bold text-[#000643] text-[26px] tabular-nums leading-tight tracking-tight">
          {fmtMoney(sales, currency)}
        </p>
        <p className="text-gray-500 text-xs">
          excl. VAT · {invoices} {invoices === 1 ? "invoice" : "invoices"} · {creditNotes}{" "}
          {creditNotes === 1 ? "credit note" : "credit notes"}
        </p>
        <dl className="mt-3 grid gap-1.5 border-gray-100 border-t pt-3 text-sm">
          <div className="flex items-baseline justify-between">
            <dt className="text-gray-500">Awaiting payment</dt>
            <dd className="font-semibold tabular-nums">{fmtMoney(awaiting, currency)}</dd>
          </div>
          <div className="flex items-baseline justify-between">
            <dt className="text-gray-500">Room-hours sold</dt>
            <dd className="font-semibold tabular-nums">
              {fmtHours(soldHours)} <span className="font-normal text-gray-400">/ {capacityHours}</span>
            </dd>
          </div>
        </dl>
        <div
          className="mt-2 flex h-1.5 overflow-hidden rounded-full bg-gray-100"
          role="img"
          aria-label={`${soldHours} of ${capacityHours} room-hours sold, ${heldHours} on hold`}>
          <span className="block h-full bg-[#000643]" style={{ width: `${pct(soldHours)}%` }} />
          <span className="block h-full" style={{ width: `${pct(heldHours)}%`, background: HATCH.held }} />
        </div>
      </Card>

      <Card className="p-4">
        <Eyebrow>Latest orders</Eyebrow>
        {latest.length === 0 ? (
          <p className="mt-2 text-gray-400 text-sm">No orders yet.</p>
        ) : (
          <ul className="mt-2 grid gap-2 text-sm">
            {latest.map((r) => (
              <li key={r.uid} className="flex items-baseline justify-between gap-3">
                <span className="min-w-0 truncate">
                  {r.bookerName} <span className="text-gray-400">· {r.roomName}</span>
                </span>
                <span className="shrink-0 text-gray-500 text-xs tabular-nums">{fmtMoment(r.orderedAt)}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
