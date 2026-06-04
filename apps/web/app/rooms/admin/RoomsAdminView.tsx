"use client";

import { trpc } from "@calcom/trpc/react";
import { useRouter } from "next/navigation";
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
  creditNoteNumber: string | null;
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
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: TZ,
    weekday: "short",
    day: "numeric",
    month: "short",
  }).format(new Date(iso));
}
function fmtTime(iso: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: TZ,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(iso));
}
function fmtMoney(cents: number, currency: string): string {
  return new Intl.NumberFormat("en-GB", { style: "currency", currency }).format(cents / 100);
}
// Sortable Brussels calendar date (YYYY-MM-DD) used as the day-filter key.
function dayKey(iso: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(iso));
}
function addOnsLabel(row: AdminBookingRow): string {
  return row.addOns.map((a) => `${a.name}×${a.quantity}`).join(", ");
}

function toCsv(rows: AdminBookingRow[]): string {
  const header = [
    "Room",
    "Category",
    "Date (Brussels)",
    "Start",
    "End",
    "Hours",
    "Status",
    "Booker name",
    "Booker email",
    "Amount",
    "Currency",
    "Add-ons",
    "Payment ID",
    "Invoice",
    "Credit note",
  ];
  const escapeCsv = (v: string | number | null): string => {
    const s = v === null ? "" : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = rows.map((r) =>
    [
      r.roomName,
      r.category,
      fmtDate(r.startUtc),
      fmtTime(r.startUtc),
      fmtTime(r.endUtc),
      r.durationMinutes / 60,
      r.status,
      r.bookerName,
      r.bookerEmail,
      (r.amountTotal / 100).toFixed(2),
      r.currency,
      r.addOns.map((a) => `${a.name} x${a.quantity} (${(a.lineTotal / 100).toFixed(2)})`).join("; "),
      r.stripePaymentId,
      r.invoiceNumber,
      r.creditNoteNumber,
    ]
      .map(escapeCsv)
      .join(",")
  );
  return [header.join(","), ...lines].join("\n");
}

export default function RoomsAdminView({ rows }: { rows: AdminBookingRow[] }): JSX.Element {
  const [status, setStatus] = useState<StatusFilter>("ALL");
  const [query, setQuery] = useState("");
  const [roomFilter, setRoomFilter] = useState("ALL");
  const [dayFilter, setDayFilter] = useState("ALL");
  const router = useRouter();
  const [pendingUid, setPendingUid] = useState<string | null>(null);
  const creditNote = trpc.viewer.rooms.issueCreditNote.useMutation({
    onSettled: () => setPendingUid(null),
    onSuccess: () => router.refresh(),
  });

  function onIssueCreditNote(row: AdminBookingRow): void {
    const ok = window.confirm(
      `Issue a credit note for ${row.bookerName} (${row.roomName})? This cancels the booking, frees the slot, and emails the booker. Refund the payment in Stripe separately.`
    );
    if (!ok) return;
    setPendingUid(row.uid);
    creditNote.mutate({ uid: row.uid });
  }

  function renderCreditNoteCell(r: AdminBookingRow): JSX.Element {
    if (r.creditNoteNumber) {
      return (
        <a
          href={`/rooms/credit-note/${r.uid}`}
          target="_blank"
          rel="noreferrer"
          className="text-[#000643] underline hover:opacity-80">
          {r.creditNoteNumber}
        </a>
      );
    }
    if (r.status === "CONFIRMED" && r.invoiceNumber) {
      return (
        <button
          type="button"
          onClick={() => onIssueCreditNote(r)}
          disabled={pendingUid === r.uid}
          className="rounded-md border border-red-200 px-2 py-1 font-medium text-red-600 text-xs transition hover:border-red-400 disabled:opacity-50">
          {pendingUid === r.uid ? "Issuing…" : "Credit note"}
        </button>
      );
    }
    return <span className="text-gray-300">—</span>;
  }

  const rooms = useMemo(() => Array.from(new Set(rows.map((r) => r.roomName))).sort(), [rows]);
  const days = useMemo(() => {
    const map = new Map<string, string>();
    for (const r of rows) {
      const key = dayKey(r.startUtc);
      if (!map.has(key)) map.set(key, fmtDate(r.startUtc));
    }
    return Array.from(map.entries())
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([key, label]) => ({ key, label }));
  }, [rows]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows.filter((r) => {
      if (status !== "ALL" && r.status !== status) return false;
      if (roomFilter !== "ALL" && r.roomName !== roomFilter) return false;
      if (dayFilter !== "ALL" && dayKey(r.startUtc) !== dayFilter) return false;
      if (q) {
        const hay =
          `${r.bookerName} ${r.bookerEmail} ${r.roomName} ${r.invoiceNumber ?? ""} ${r.creditNoteNumber ?? ""}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [rows, status, roomFilter, dayFilter, query]);
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
        <div className="flex items-center gap-2">
          <a
            href="/rooms/admin/rooms"
            className="rounded-lg border border-gray-200 px-4 py-2 font-semibold text-[#000643] text-sm transition hover:border-[#000643]">
            Manage rooms
          </a>
          <a
            href="/rooms/admin/addons"
            className="rounded-lg border border-gray-200 px-4 py-2 font-semibold text-[#000643] text-sm transition hover:border-[#000643]">
            Manage add-ons
          </a>
          <a
            href="/rooms/admin/settings"
            className="rounded-lg border border-gray-200 px-4 py-2 font-semibold text-[#000643] text-sm transition hover:border-[#000643]">
            Invoice settings
          </a>
          <button
            type="button"
            onClick={downloadCsv}
            className="rounded-lg bg-[#000643] px-4 py-2 font-semibold text-sm text-white transition hover:opacity-90">
            Export CSV
          </button>
        </div>
      </div>

      <div className="mt-4 flex gap-2">
        {STATUS_FILTERS.map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => setStatus(s)}
            className={`rounded-lg border px-3 py-1.5 font-medium text-sm transition ${
              s === status
                ? "border-[#000643] bg-[#000643] text-white"
                : "border-gray-200 bg-white text-black hover:border-[#000643]"
            }`}>
            {s === "ALL" ? "All" : s.charAt(0) + s.slice(1).toLowerCase()}
          </button>
        ))}
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search name, email, invoice…"
          className="min-w-56 flex-1 rounded-lg border border-gray-200 px-3 py-1.5 text-sm focus:border-[#000643] focus:outline-none"
        />
        <select
          value={roomFilter}
          onChange={(e) => setRoomFilter(e.target.value)}
          className="rounded-lg border border-gray-200 px-3 py-1.5 text-sm focus:border-[#000643] focus:outline-none">
          <option value="ALL">All rooms</option>
          {rooms.map((name) => (
            <option key={name} value={name}>
              {name}
            </option>
          ))}
        </select>
        <select
          value={dayFilter}
          onChange={(e) => setDayFilter(e.target.value)}
          className="rounded-lg border border-gray-200 px-3 py-1.5 text-sm focus:border-[#000643] focus:outline-none">
          <option value="ALL">All days</option>
          {days.map((d) => (
            <option key={d.key} value={d.key}>
              {d.label}
            </option>
          ))}
        </select>
        <span className="text-gray-400 text-xs">{filtered.length} shown</span>
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
              <th className="px-3 py-2">Invoice</th>
              <th className="px-3 py-2">Credit note</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr>
                <td className="px-3 py-6 text-center text-gray-400" colSpan={8}>
                  No bookings
                </td>
              </tr>
            ) : (
              filtered.map((r) => (
                <tr key={r.uid} className="border-gray-50 border-b last:border-0">
                  <td className="px-3 py-2">
                    <a href={`/rooms/admin/${r.uid}`} className="font-medium text-[#000643] hover:underline">
                      {r.roomName}
                    </a>
                    <div className="text-gray-400 text-xs">{r.category}</div>
                  </td>
                  <td className="px-3 py-2">
                    {fmtDate(r.startUtc)} · {fmtTime(r.startUtc)}–{fmtTime(r.endUtc)} (
                    {r.durationMinutes / 60}h)
                  </td>
                  <td className="px-3 py-2">
                    <span
                      className={`rounded-full px-2 py-0.5 font-medium text-xs ${STATUS_BADGE[r.status] ?? ""}`}>
                      {r.status}
                    </span>
                  </td>
                  <td className="px-3 py-2">
                    <div>{r.bookerName}</div>
                    <div className="text-gray-400 text-xs">{r.bookerEmail}</div>
                  </td>
                  <td className="px-3 py-2 text-gray-600">{addOnsLabel(r) || "—"}</td>
                  <td className="px-3 py-2 text-right font-medium">{fmtMoney(r.amountTotal, r.currency)}</td>
                  <td className="px-3 py-2">
                    {r.invoiceNumber ? (
                      <a
                        href={`/rooms/invoice/${r.uid}`}
                        target="_blank"
                        rel="noreferrer"
                        className="text-[#000643] underline hover:opacity-80">
                        {r.invoiceNumber}
                      </a>
                    ) : (
                      <span className="text-gray-300">—</span>
                    )}
                  </td>
                  <td className="px-3 py-2">{renderCreditNoteCell(r)}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
