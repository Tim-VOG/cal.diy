"use client";

import { orderRef } from "@calcom/features/ne26-rooms/lib/orderRef";
import { buildXlsx, type CellValue } from "@calcom/features/ne26-rooms/lib/xlsx";
import { Download, Search } from "lucide-react";
import { Fragment, useMemo, useState } from "react";
import {
  dayKey,
  displayStatus,
  fmtCountdown,
  fmtDay,
  fmtDayLong,
  fmtMoment,
  fmtMoney,
  fmtTime,
} from "./format";
import type { AdminBookingRow } from "./RoomsAdminView";
import { StatusPill } from "./ui";

const STATUS_FILTERS = ["ALL", "CONFIRMED", "PENDING", "REFUNDED", "CANCELLED"] as const;
type StatusFilter = (typeof STATUS_FILTERS)[number];

type SortKey = "when" | "room" | "booker" | "order" | "status" | "amount" | "document";
/**
 * One line per room. Email, category, payment date and add-on detail used to
 * give every row three lines; they are one click away in the side panel, and
 * all of them are still in the export.
 */
const COLUMNS: { key: SortKey; label: string; align?: "right" }[] = [
  { key: "when", label: "When (TRT)" },
  { key: "room", label: "Room" },
  { key: "booker", label: "Booker" },
  { key: "order", label: "Order" },
  { key: "status", label: "Status" },
  { key: "amount", label: "Excl. VAT", align: "right" },
  { key: "document", label: "Invoice" },
];

/**
 * The columns the accounting team works from, in the order they read them —
 * the export keeps every one even though the screen shows fewer. An .xlsx opens
 * on a double click with its types intact, and a cell written as an inline
 * string is text to Excel, never a formula, so a booker name typed as
 * `=HYPERLINK(...)` at Stripe cannot execute when the file is opened.
 */
const EXPORT_HEADERS = [
  "Order",
  "Room",
  "Category",
  "Date (Istanbul)",
  "Start",
  "End",
  "Hours",
  "Status",
  "Booker name",
  "Booker email",
  "Ordered at",
  "Paid at",
  "Amount excl. VAT",
  "Currency",
  "Add-ons",
  "Payment ID",
  "Invoice",
  "Credit note",
];

function exportRows(rows: AdminBookingRow[]): CellValue[][] {
  return rows.map((r) => [
    r.orderNumber !== null ? orderRef(r.orderNumber) : "",
    r.roomName,
    r.category,
    fmtDay(r.startUtc),
    fmtTime(r.startUtc),
    fmtTime(r.endUtc),
    r.durationMinutes / 60,
    displayStatus(r),
    r.bookerName,
    r.bookerEmail,
    fmtMoment(r.orderedAt),
    r.paidAt ? fmtMoment(r.paidAt) : "",
    // A number, so the accountant can sum the column instead of retyping it.
    r.amountTotal / 100,
    r.currency,
    r.addOns.map((a) => `${a.name} x${a.quantity} (${(a.lineTotal / 100).toFixed(2)})`).join("; "),
    r.stripePaymentId,
    r.invoiceNumber,
    r.creditNoteNumber,
  ]);
}

const segment = (on: boolean) =>
  `inline-flex items-center gap-1.5 whitespace-nowrap rounded-md px-2.5 py-1 font-medium text-[13px] transition ${
    on ? "bg-[#000643] text-white" : "text-gray-700 hover:bg-gray-100"
  }`;

export default function BookingsTable({
  rows,
  selectedUid,
  onSelect,
  now,
}: {
  rows: AdminBookingRow[];
  selectedUid: string | null;
  onSelect: (uid: string) => void;
  now: Date | null;
}): JSX.Element {
  const [status, setStatus] = useState<StatusFilter>("ALL");
  const [query, setQuery] = useState("");
  const [roomFilter, setRoomFilter] = useState("ALL");
  const [dayFilter, setDayFilter] = useState("ALL");
  const [sort, setSort] = useState<{ key: SortKey; dir: "asc" | "desc" }>({ key: "when", dir: "asc" });

  const rooms = useMemo(() => Array.from(new Set(rows.map((r) => r.roomName))).sort(), [rows]);
  const days = useMemo(() => {
    const map = new Map<string, string>();
    for (const r of rows) if (!map.has(dayKey(r.startUtc))) map.set(dayKey(r.startUtc), fmtDay(r.startUtc));
    return Array.from(map.entries()).sort((a, b) => a[0].localeCompare(b[0]));
  }, [rows]);
  const counts = useMemo(() => {
    const c: Record<string, number> = { ALL: rows.length };
    for (const r of rows) c[displayStatus(r)] = (c[displayStatus(r)] ?? 0) + 1;
    return c;
  }, [rows]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows.filter((r) => {
      if (status !== "ALL" && displayStatus(r) !== status) return false;
      if (roomFilter !== "ALL" && r.roomName !== roomFilter) return false;
      if (dayFilter !== "ALL" && dayKey(r.startUtc) !== dayFilter) return false;
      if (q) {
        const hay =
          `${r.bookerName} ${r.bookerEmail} ${r.roomName} ${r.invoiceNumber ?? ""} ${r.creditNoteNumber ?? ""} ${r.orderNumber !== null ? orderRef(r.orderNumber) : ""}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [rows, status, roomFilter, dayFilter, query]);

  const sorted = useMemo(() => {
    const { key, dir } = sort;
    const sign = dir === "asc" ? 1 : -1;
    const value = (r: AdminBookingRow): string | number => {
      switch (key) {
        case "room":
          return r.roomName;
        case "booker":
          return `${r.bookerName} ${r.bookerEmail}`;
        case "status":
          return displayStatus(r);
        case "order":
          return r.orderNumber ?? "";
        case "amount":
          return r.amountTotal;
        case "document":
          return r.invoiceNumber ?? "";
        default:
          return r.startUtc;
      }
    };
    return [...filtered].sort((a, b) => {
      const av = value(a);
      const bv = value(b);
      if (typeof av === "number" && typeof bv === "number") return (av - bv) * sign;
      // Blanks last whichever way the column points: an unpaid booking has no
      // payment date, and burying those among the dates helps nobody.
      if (av === "" && bv !== "") return 1;
      if (bv === "" && av !== "") return -1;
      return String(av).localeCompare(String(bv), "en") * sign;
    });
  }, [filtered, sort]);

  // Grouped by day only while sorted by time: grouped under another sort, the
  // headings would claim an order the rows no longer follow.
  const grouped = sort.key === "when";

  function sortBy(key: SortKey): void {
    setSort((s) => (s.key === key ? { key, dir: s.dir === "asc" ? "desc" : "asc" } : { key, dir: "asc" }));
  }

  function downloadExcel(): void {
    const book = buildXlsx({ sheetName: "Bookings", headers: EXPORT_HEADERS, rows: exportRows(sorted) });
    const blob = new Blob([book as BlobPart], {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `ne26-bookings-${new Date().toISOString().slice(0, 10)}.xlsx`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const select =
    "rounded-lg border border-gray-200 bg-white px-2.5 py-1.5 text-[13px] focus:border-[#000643] focus:outline-none";

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2">
        <div
          className="flex flex-wrap gap-0.5 rounded-lg border border-gray-200 bg-white p-0.5"
          role="group"
          aria-label="Status">
          {STATUS_FILTERS.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setStatus(s)}
              aria-pressed={s === status}
              className={segment(s === status)}>
              {s === "ALL" ? "All" : s.charAt(0) + s.slice(1).toLowerCase()}
              <span
                className={`text-[11px] tabular-nums ${s === status ? "text-white/70" : "text-gray-400"}`}>
                {counts[s] ?? 0}
              </span>
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={downloadExcel}
          className="ml-auto inline-flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 py-1.5 font-semibold text-[#000643] text-[13px] transition hover:border-[#000643]">
          <Download className="h-3.5 w-3.5" aria-hidden />
          Export Excel
        </button>
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-2">
        <label className="flex min-w-56 flex-1 items-center gap-2 rounded-lg border border-gray-200 bg-white px-2.5 py-1.5 focus-within:border-[#000643]">
          <Search className="h-3.5 w-3.5 text-gray-400" aria-hidden />
          <span className="sr-only">Search</span>
          <input
            id="bookings-search"
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search name, email, invoice, #reference…"
            className="w-full bg-transparent text-[13px] focus:outline-none"
          />
        </label>
        <select
          id="bookings-room"
          aria-label="Room"
          value={roomFilter}
          onChange={(e) => setRoomFilter(e.target.value)}
          className={select}>
          <option value="ALL">All rooms</option>
          {rooms.map((name) => (
            <option key={name} value={name}>
              {name}
            </option>
          ))}
        </select>
        <select
          id="bookings-day"
          aria-label="Day"
          value={dayFilter}
          onChange={(e) => setDayFilter(e.target.value)}
          className={select}>
          <option value="ALL">All days</option>
          {days.map(([key, label]) => (
            <option key={key} value={key}>
              {label}
            </option>
          ))}
        </select>
        <span className="text-gray-500 text-xs tabular-nums">{filtered.length} shown</span>
      </div>

      <div className="mt-3 overflow-x-auto rounded-xl border border-gray-200 bg-white">
        <table className="w-full min-w-[50rem] text-left text-[13px]">
          <thead className="border-gray-200 border-b bg-gray-50/80">
            <tr>
              {COLUMNS.map(({ key, label, align }) => (
                <th key={key} scope="col" className={`px-3 py-2.5 ${align === "right" ? "text-right" : ""}`}>
                  <button
                    type="button"
                    onClick={() => sortBy(key)}
                    className={`inline-flex items-center gap-1 whitespace-nowrap font-semibold text-[10.5px] uppercase tracking-[0.05em] transition hover:text-[#000643] ${
                      sort.key === key ? "text-[#000643]" : "text-gray-500"
                    }`}>
                    {label}
                    <span aria-hidden className={sort.key === key ? "" : "opacity-0"}>
                      {sort.dir === "asc" ? "▲" : "▼"}
                    </span>
                  </button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sorted.length === 0 ? (
              <tr>
                <td className="px-3 py-8 text-center text-gray-400" colSpan={COLUMNS.length}>
                  No bookings match these filters.
                </td>
              </tr>
            ) : (
              sorted.map((r, i) => {
                const key = dayKey(r.startUtc);
                const newDay = grouped && (i === 0 || dayKey(sorted[i - 1].startUtc) !== key);
                const dayRows = newDay ? sorted.filter((x) => dayKey(x.startUtc) === key) : [];
                const dayConfirmed = dayRows
                  .filter((x) => x.status === "CONFIRMED")
                  .reduce((s, x) => s + x.amountTotal, 0);
                const shown = displayStatus(r);
                const msLeft =
                  r.status === "PENDING" && r.holdExpiresAt && now
                    ? new Date(r.holdExpiresAt).getTime() - now.getTime()
                    : null;
                return (
                  <Fragment key={r.uid}>
                    {newDay ? (
                      <tr>
                        <td
                          colSpan={COLUMNS.length}
                          className="border-gray-200 border-y bg-[#000643]/[0.035] px-3 py-1.5 font-semibold text-[#000643] text-xs">
                          {fmtDayLong(r.startUtc)}
                          <span className="ml-2 font-normal text-gray-500">
                            {dayRows.length} {dayRows.length === 1 ? "booking" : "bookings"} ·{" "}
                            {fmtMoney(dayConfirmed, r.currency)} confirmed
                          </span>
                        </td>
                      </tr>
                    ) : null}
                    <tr
                      onClick={() => onSelect(r.uid)}
                      className={`cursor-pointer border-gray-100 border-b align-top transition last:border-0 ${
                        r.uid === selectedUid ? "bg-[#000643]/[0.05]" : "hover:bg-gray-50"
                      } ${shown === "CANCELLED" ? "text-gray-400" : ""}`}>
                      <td className="whitespace-nowrap px-3 py-2 tabular-nums">
                        {grouped ? null : <span className="text-gray-500">{fmtDay(r.startUtc)} · </span>}
                        <span className="font-semibold">
                          {fmtTime(r.startUtc)}–{fmtTime(r.endUtc)}
                        </span>
                        <span className="ml-1.5 text-gray-400 text-xs">{r.durationMinutes / 60} h</span>
                      </td>
                      <td className="whitespace-nowrap px-3 py-2">
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            onSelect(r.uid);
                          }}
                          className="font-semibold text-[#000643] hover:underline">
                          {r.roomName}
                        </button>
                        {r.addOns.length ? (
                          <span
                            className="ml-1.5 text-gray-400 text-xs"
                            title={r.addOns.map((a) => `${a.name} × ${a.quantity}`).join(", ")}>
                            + {r.addOns.length} {r.addOns.length === 1 ? "add-on" : "add-ons"}
                          </span>
                        ) : null}
                      </td>
                      <td className="max-w-[14rem] truncate px-3 py-2" title={r.bookerEmail}>
                        {r.bookerName}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2 font-mono text-gray-500 text-xs">
                        {r.orderNumber !== null ? orderRef(r.orderNumber) : "—"}
                        {r.orderRoomCount > 1 ? (
                          <span className="ml-1 font-sans text-gray-400">· {r.orderRoomCount} rooms</span>
                        ) : null}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2">
                        <StatusPill status={shown} />
                        {msLeft !== null ? (
                          <span
                            className={`ml-2 font-semibold text-xs tabular-nums ${msLeft < 5 * 60_000 ? "text-red-600" : "text-amber-700"}`}>
                            {fmtCountdown(msLeft)}
                          </span>
                        ) : null}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2 text-right font-semibold tabular-nums">
                        {fmtMoney(r.amountTotal, r.currency)}
                      </td>
                      <td
                        className="whitespace-nowrap px-3 py-2 text-xs"
                        onClick={(e) => e.stopPropagation()}>
                        {r.invoiceNumber ? (
                          <a
                            href={`/rooms/invoice/${r.documentUid}`}
                            target="_blank"
                            rel="noreferrer"
                            className="text-[#000643] underline decoration-[#000643]/30 underline-offset-2">
                            {r.invoiceNumber}
                          </a>
                        ) : r.status === "CONFIRMED" && r.orderUid ? (
                          <span className="rounded bg-amber-50 px-1.5 py-0.5 font-semibold text-[10.5px] text-amber-800 ring-1 ring-amber-600/20 ring-inset">
                            Invoice missing
                          </span>
                        ) : (
                          <span className="text-gray-300">—</span>
                        )}
                        {r.creditNoteNumber ? (
                          <a
                            href={`/rooms/credit-note/${r.documentUid}`}
                            target="_blank"
                            rel="noreferrer"
                            title="Credit note"
                            className="ml-2 text-gray-500 underline decoration-gray-300 underline-offset-2">
                            {r.creditNoteNumber}
                          </a>
                        ) : null}
                      </td>
                    </tr>
                  </Fragment>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
