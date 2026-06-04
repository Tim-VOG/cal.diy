"use client";

import { useMemo, useState } from "react";

const TZ = "Europe/Brussels";

export interface AdminBookingRow {
  uid: string;
  status: string;
  roomName: string;
  category: string;
  startUtc: string;
  endUtc: string;
  durationMinutes: number;
  bookerName: string;
  bookerEmail: string;
  amountTotal: number;
  currency: string;
  stripePaymentId: string | null;
  invoiceNumber: string | null;
  addOns: { name: string; quantity: number; lineTotal: number }[];
}

const STATUS_FILTERS = ["ALL", "CONFIRMED", "PENDING", "CANCELLED"] as const;
type StatusFilter = (typeof STATUS_FILTERS)[number];

const STATUS_BADGE: Record<string, string> = {
  CONFIRMED: "bg-green-100 text-green-700",
  PENDING: "bg-amber-100 text-amber-700",
  CANCELLED: "bg-gray-100 text-gray-500",
};

function fmtDate(iso: string): string {
  return new Intl.DateTimeFormat("en-GB", { timeZone: TZ, weekday: "short", day: "numeric", month: "short" }).format(
    new Date(iso)
  );
}
function fmtTime(iso: string): string {
  return new Intl.DateTimeFormat("en-GB", { timeZone: TZ, hour: "2-digit", minute: "2-digit", hour12: false }).format(
    new Date(iso)
  );
}
function fmtMoney(cents: number, currency: string): string {
  return new Intl.NumberFormat("en-GB", { style: "currency", currency }).format(cents / 100);
}
function addOnsLabel(row: AdminBookingRow): string {
  return row.addOns.map((a) => `${a.name}×${a.quantity}`).join(", ");
}

function toCsv(rows: AdminBookingRow[]): string {
  const header = [
    "Room", "Category", "Date (Brussels)", "Start", "End", "Hours", "Status",
    "Booker name", "Booker email", "Amount", "Currency", "Add-ons", "Payment ID", "Invoice",
  ];
  const escapeCsv = (v: string | number | null): string => {
    const s = v === null ? "" : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = rows.map((r) =>
    [
      r.roomName, r.category, fmtDate(r.startUtc), fmtTime(r.startUtc), fmtTime(r.endUtc),
      r.durationMinutes / 60, r.status, r.bookerName, r.bookerEmail, (r.amountTotal / 100).toFixed(2),
      r.currency, r.addOns.map((a) => `${a.name} x${a.quantity} (${(a.lineTotal / 100).toFixed(2)})`).join("; "),
      r.stripePaymentId, r.invoiceNumber,
    ]
      .map(escapeCsv)
      .join(",")
  );
  return [header.join(","), ...lines].join("\n");
}

export default function RoomsAdminView({ rows }: { rows: AdminBookingRow[] }): JSX.Element {
  const [status, setStatus] = useState<StatusFilter>("ALL");

  const filtered = useMemo(() => (status === "ALL" ? rows : rows.filter((r) => r.status === status)), [rows, status]);
  const confirmed = useMemo(() => rows.filter((r) => r.status === "CONFIRMED"), [rows]);
  const revenue = confirmed.reduce((sum, r) => sum + r.amountTotal, 0);
  const currency = rows[0]?.currency ?? "EUR";

  function downloadCsv(): void {
    const blob = new Blob([toCsv(filtered)], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `ne26-bookings-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-bold text-2xl text-[#000643]">Bookings admin</h1>
          <p className="mt-1 text-gray-600 text-sm">
            {rows.length} bookings · {confirmed.length} confirmed · {fmtMoney(revenue, currency)} collected
          </p>
        </div>
        <button
          type="button"
          onClick={downloadCsv}
          className="rounded-lg bg-[#000643] px-4 py-2 font-semibold text-sm text-white transition hover:opacity-90">
          Export CSV
        </button>
      </div>

      <div className="mt-4 flex gap-2">
        {STATUS_FILTERS.map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => setStatus(s)}
            className={`rounded-lg border px-3 py-1.5 font-medium text-sm transition ${
              s === status ? "border-[#000643] bg-[#000643] text-white" : "border-gray-200 bg-white text-black hover:border-[#000643]"
            }`}>
            {s === "ALL" ? "All" : s.charAt(0) + s.slice(1).toLowerCase()}
          </button>
        ))}
      </div>

      <div className="mt-4 overflow-x-auto rounded-xl border border-gray-200 bg-white">
        <table className="w-full text-left text-sm">
          <thead className="border-gray-100 border-b bg-gray-50 text-gray-500 text-xs uppercase">
            <tr>
              <th className="px-3 py-2">Room</th>
              <th className="px-3 py-2">When (Brussels)</th>
              <th className="px-3 py-2">Status</th>
              <th className="px-3 py-2">Booker</th>
              <th className="px-3 py-2">Add-ons</th>
              <th className="px-3 py-2 text-right">Amount</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr>
                <td className="px-3 py-6 text-center text-gray-400" colSpan={6}>
                  No bookings
                </td>
              </tr>
            ) : (
              filtered.map((r) => (
                <tr key={r.uid} className="border-gray-50 border-b last:border-0">
                  <td className="px-3 py-2">
                    <div className="font-medium">{r.roomName}</div>
                    <div className="text-gray-400 text-xs">{r.category}</div>
                  </td>
                  <td className="px-3 py-2">
                    {fmtDate(r.startUtc)} · {fmtTime(r.startUtc)}–{fmtTime(r.endUtc)} ({r.durationMinutes / 60}h)
                  </td>
                  <td className="px-3 py-2">
                    <span className={`rounded-full px-2 py-0.5 font-medium text-xs ${STATUS_BADGE[r.status] ?? ""}`}>
                      {r.status}
                    </span>
                  </td>
                  <td className="px-3 py-2">
                    <div>{r.bookerName}</div>
                    <div className="text-gray-400 text-xs">{r.bookerEmail}</div>
                  </td>
                  <td className="px-3 py-2 text-gray-600">{addOnsLabel(r) || "—"}</td>
                  <td className="px-3 py-2 text-right font-medium">{fmtMoney(r.amountTotal, r.currency)}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
