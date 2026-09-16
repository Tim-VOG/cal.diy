"use client";

import { orderRef } from "@calcom/features/ne26-rooms/lib/orderRef";
import Link from "next/link";
import { displayStatus, fmtHours, fmtMoment, fmtMoney } from "./format";
import type { AdminBookingRow } from "./RoomsAdminView";
import { Card, Eyebrow, HATCH, StatusPill } from "./ui";

/**
 * Money and occupancy in one strip across the top.
 *
 * It sat in a narrow column beside "Needs attention", and whichever of the two
 * was shorter left a hole under it. A strip is the same height whatever the
 * list holds.
 *
 * "Confirmed sales", not "collected": the figure counts every confirmed booking,
 * including an order marked paid by hand after a bank transfer. Calling it
 * collected would claim Stripe had it.
 */
export function SalesStrip({
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
  const sales = rows.filter((r) => r.status === "CONFIRMED").reduce((sum, r) => sum + r.amountTotal, 0);
  const pending = rows.filter((r) => r.status === "PENDING");
  const awaiting = pending.reduce((sum, r) => sum + r.amountTotal, 0);
  const holds = new Set(pending.map((r) => r.orderUid ?? r.uid)).size;
  const invoices = new Set(rows.filter((r) => r.invoiceNumber).map((r) => r.invoiceNumber)).size;
  const creditNotes = new Set(rows.filter((r) => r.creditNoteNumber).map((r) => r.creditNoteNumber)).size;

  const pct = (h: number) => (capacityHours > 0 ? Math.min(100, (h / capacityHours) * 100) : 0);

  return (
    <Card className="grid divide-gray-100 sm:grid-cols-2 lg:grid-cols-[1.4fr_1fr_1.2fr_1fr] lg:divide-x">
      <div className="p-4">
        <Eyebrow>Confirmed sales</Eyebrow>
        <p className="mt-1 font-bold text-[#000643] text-[28px] tabular-nums leading-tight tracking-tight">
          {fmtMoney(sales, currency)}
        </p>
        <p className="text-gray-500 text-xs">excl. VAT</p>
      </div>
      <div className="border-gray-100 border-t p-4 sm:border-t-0">
        <Eyebrow>Awaiting payment</Eyebrow>
        <p className="mt-1 font-semibold text-[20px] text-gray-900 tabular-nums leading-tight">
          {fmtMoney(awaiting, currency)}
        </p>
        <p className="text-gray-500 text-xs">
          {holds === 0 ? "No hold running" : `${holds} ${holds === 1 ? "hold" : "holds"} running`}
        </p>
      </div>
      <div className="border-gray-100 border-t p-4 lg:border-t-0">
        <Eyebrow>Room-hours sold</Eyebrow>
        <p className="mt-1 font-semibold text-[20px] text-gray-900 tabular-nums leading-tight">
          {fmtHours(soldHours)}{" "}
          <span className="font-normal text-[15px] text-gray-400">/ {capacityHours}</span>
        </p>
        <div
          className="mt-2 flex h-1.5 overflow-hidden rounded-full bg-gray-100"
          role="img"
          aria-label={`${soldHours} of ${capacityHours} room-hours sold, ${heldHours} on hold`}>
          <span className="block h-full bg-[#000643]" style={{ width: `${pct(soldHours)}%` }} />
          <span className="block h-full" style={{ width: `${pct(heldHours)}%`, background: HATCH.held }} />
        </div>
      </div>
      <div className="border-gray-100 border-t p-4 lg:border-t-0">
        <Eyebrow>Documents</Eyebrow>
        <p className="mt-1 font-semibold text-[20px] text-gray-900 tabular-nums leading-tight">
          {invoices}{" "}
          <span className="font-normal text-[13px] text-gray-500">
            {invoices === 1 ? "invoice" : "invoices"}
          </span>
        </p>
        <p className="text-gray-500 text-xs tabular-nums">
          {creditNotes} {creditNotes === 1 ? "credit note" : "credit notes"}
        </p>
      </div>
    </Card>
  );
}

/**
 * The last orders to come in, newest first. A log, read after everything else,
 * so it sits at the bottom of the page. One line per order, not per room.
 */
export function LatestOrders({ rows, limit = 8 }: { rows: AdminBookingRow[]; limit?: number }): JSX.Element {
  const byOrder = new Map<string, AdminBookingRow[]>();
  for (const r of rows) {
    const key = r.orderUid ?? r.uid;
    byOrder.set(key, [...(byOrder.get(key) ?? []), r]);
  }
  const latest = Array.from(byOrder.values())
    .map((rooms) => ({ first: rooms[0], rooms, amount: rooms.reduce((sum, r) => sum + r.amountTotal, 0) }))
    .sort((a, b) => b.first.orderedAt.localeCompare(a.first.orderedAt))
    .slice(0, limit);

  return (
    <Card>
      <header className="flex items-baseline justify-between gap-2 px-4 pt-3 pb-2">
        <h2 className="font-semibold text-[#000643] text-[15px]">Latest orders</h2>
        <span className="text-gray-500 text-xs">Newest first</span>
      </header>
      {latest.length === 0 ? (
        <p className="px-4 pb-4 text-gray-400 text-sm">No orders yet.</p>
      ) : (
        <ul className="text-[13px]">
          {latest.map(({ first, rooms, amount }) => {
            const where =
              rooms.length === 1 ? first.roomName : `${first.roomName} + ${rooms.length - 1} more`;
            const cls = "flex items-center gap-3 border-gray-100 border-t px-4 py-2";
            const line = (
              <>
                <span className="w-28 shrink-0 font-mono text-gray-500 text-xs">
                  {first.orderNumber !== null ? orderRef(first.orderNumber) : "—"}
                </span>
                <span className="min-w-0 flex-1 truncate">
                  {first.bookerName} <span className="text-gray-400">· {where}</span>
                </span>
                <span className="hidden w-24 shrink-0 justify-end sm:flex">
                  <StatusPill status={displayStatus(first)} />
                </span>
                <span className="w-24 shrink-0 text-right font-semibold tabular-nums">
                  {fmtMoney(amount, first.currency)}
                </span>
                <span className="hidden w-32 shrink-0 text-right text-gray-500 text-xs tabular-nums md:inline">
                  {fmtMoment(first.orderedAt)}
                </span>
              </>
            );
            return (
              <li key={first.orderUid ?? first.uid}>
                {first.orderUid ? (
                  <Link
                    href={`/rooms/admin/order/${first.orderUid}`}
                    className={`${cls} transition hover:bg-gray-50`}>
                    {line}
                  </Link>
                ) : (
                  <div className={cls}>{line}</div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}
