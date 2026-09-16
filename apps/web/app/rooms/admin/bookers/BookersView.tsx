"use client";

import { EVENT_TIME_ZONE } from "@calcom/features/ne26-rooms/lib/eventSchedule";
import { buildXlsx, type CellValue } from "@calcom/features/ne26-rooms/lib/xlsx";
import { ChevronDown, Download, Search } from "lucide-react";
import { Fragment, useMemo, useState } from "react";
import { dayKey, displayStatus, fmtDay, fmtTime } from "../format";
import { HATCH, StatusPill } from "../ui";

const TZ = EVENT_TIME_ZONE;

export interface BookerBooking {
  uid: string;
  roomName: string;
  startUtc: string;
  endUtc: string;
  status: string;
  amountTotal: number;
  currency: string;
  /** The uid the invoice and credit-note PDFs are stored under — the order's. */
  documentUid: string;
  invoiceNumber: string | null;
  creditNoteNumber: string | null;
  addOns: { name: string; quantity: number }[];
}

export interface Booker {
  email: string;
  name: string;
  currency: string;
  bookingCount: number;
  confirmedTotal: number;
  bookings: BookerBooking[];
}

function money(cents: number, currency: string): string {
  return new Intl.NumberFormat("en-GB", { style: "currency", currency }).format(cents / 100);
}
function fmt(iso: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: TZ,
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(iso));
}

type BookerSort = "name" | "bookings" | "total";

const BOOKER_SORTS: { key: BookerSort; label: string }[] = [
  { key: "name", label: "Name" },
  { key: "bookings", label: "Bookings" },
  { key: "total", label: "Total spent" },
];

export default function BookersView({
  bookers,
  eventDates,
}: {
  bookers: Booker[];
  /** The event's days (YYYY-MM-DD, TRT), for the day chips. */
  eventDates: string[];
}): JSX.Element {
  const [query, setQuery] = useState("");
  const [openEmail, setOpenEmail] = useState<string | null>(null);
  const [sort, setSort] = useState<{ key: BookerSort; dir: "asc" | "desc" }>({
    key: "name",
    dir: "asc",
  });

  /** Same control again flips the direction; a new one starts ascending. */
  function sortBy(key: BookerSort): void {
    setSort((s) => (s.key === key ? { key, dir: s.dir === "asc" ? "desc" : "asc" } : { key, dir: "asc" }));
  }

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return bookers;
    return bookers.filter((b) => b.name.toLowerCase().includes(q) || b.email.toLowerCase().includes(q));
  }, [bookers, query]);

  /**
   * Alphabetical is how you find somebody; by spend is how you see who your
   * biggest exhibitors are. The list only ever offered the first.
   */
  const sorted = useMemo(() => {
    const sign = sort.dir === "asc" ? 1 : -1;
    return [...filtered].sort((a, b) => {
      if (sort.key === "bookings") return (a.bookingCount - b.bookingCount) * sign;
      if (sort.key === "total") return (a.confirmedTotal - b.confirmedTotal) * sign;
      return (a.name || a.email).localeCompare(b.name || b.email, "en") * sign;
    });
  }, [filtered, sort]);

  function downloadExcel(): void {
    const rows: CellValue[][] = sorted.map((b) => [
      b.name,
      b.email,
      b.bookingCount,
      // A number, so the column sums.
      b.confirmedTotal / 100,
      b.currency,
      b.bookings.map((x) => `${x.roomName} ${fmt(x.startUtc)} (${x.status})`).join("; "),
    ]);
    const book = buildXlsx({
      sheetName: "Bookers",
      headers: ["Name", "Email", "Bookings", "Confirmed total", "Currency", "Rooms"],
      rows,
    });
    const blob = new Blob([book as BlobPart], {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `ne26-bookers-${new Date().toISOString().slice(0, 10)}.xlsx`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div>
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-bold text-2xl text-[#000643] tracking-tight">Bookers</h1>
          <p className="mt-1 text-gray-600 text-sm">Everyone who has booked a room, and on which days.</p>
        </div>
        <button
          type="button"
          onClick={downloadExcel}
          className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 py-1.5 font-semibold text-[#000643] text-[13px] transition hover:border-[#000643]">
          <Download className="h-3.5 w-3.5" aria-hidden />
          Export Excel
        </button>
      </header>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <label className="flex w-full max-w-sm items-center gap-2 rounded-lg border border-gray-200 bg-white px-2.5 py-1.5 focus-within:border-[#000643]">
          <Search className="h-3.5 w-3.5 text-gray-400" aria-hidden />
          <span className="sr-only">Search bookers</span>
          <input
            id="bookers-search"
            type="search"
            placeholder="Search by name or email…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="w-full bg-transparent text-[13px] focus:outline-none"
          />
        </label>
        <div
          className="inline-flex gap-0.5 rounded-lg border border-gray-200 bg-white p-0.5"
          role="group"
          aria-label="Sort">
          {BOOKER_SORTS.map(({ key, label }) => (
            <button
              key={key}
              type="button"
              onClick={() => sortBy(key)}
              aria-pressed={sort.key === key}
              className={`rounded-md px-2.5 py-1 font-medium text-[13px] transition ${
                sort.key === key ? "bg-[#000643] text-white" : "text-gray-700 hover:bg-gray-100"
              }`}>
              {label}
              {sort.key === key ? <span aria-hidden> {sort.dir === "asc" ? "▲" : "▼"}</span> : null}
            </button>
          ))}
        </div>
        <span className="ml-auto text-gray-500 text-xs tabular-nums">
          {sorted.length} {sorted.length === 1 ? "booker" : "bookers"} ·{" "}
          {sorted.reduce((n, b) => n + b.bookingCount, 0)} bookings
        </span>
      </div>

      <div className="mt-3 overflow-x-auto rounded-xl border border-gray-200 bg-white">
        <table className="w-full min-w-[46rem] text-left text-[13px]">
          <thead className="border-gray-200 border-b bg-gray-50/80 text-[10.5px] text-gray-500 uppercase tracking-[0.05em]">
            <tr>
              <th className="px-4 py-2.5 font-semibold">Booker</th>
              <th className="px-4 py-2.5 font-semibold">Days</th>
              <th className="px-4 py-2.5 text-right font-semibold">Bookings</th>
              <th className="px-4 py-2.5 text-right font-semibold">Confirmed total</th>
              <th className="px-4 py-2.5 text-right font-semibold">On hold</th>
              <th className="w-10 px-2 py-2.5" aria-label="Expand" />
            </tr>
          </thead>
          <tbody>
            {sorted.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-gray-400">
                  No bookers yet.
                </td>
              </tr>
            ) : (
              sorted.map((b) => {
                const open = openEmail === b.email;
                const onHold = b.bookings
                  .filter((x) => x.status === "PENDING")
                  .reduce((n, x) => n + x.amountTotal, 0);
                const invoiceMissing = b.bookings.some((x) => x.status === "CONFIRMED" && !x.invoiceNumber);
                const refunded = b.bookings.some((x) => displayStatus(x) === "REFUNDED");
                return (
                  <Fragment key={b.email}>
                    <tr
                      onClick={() => setOpenEmail(open ? null : b.email)}
                      className={`cursor-pointer border-gray-100 border-b align-middle transition ${open ? "bg-[#000643]/[0.04]" : "hover:bg-gray-50"}`}>
                      <td className="px-4 py-2.5">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span className="font-semibold text-[#000643]">{b.name || b.email}</span>
                          {invoiceMissing ? (
                            <span className="rounded bg-amber-50 px-1.5 font-semibold text-[10.5px] text-amber-800 ring-1 ring-amber-600/20 ring-inset">
                              Invoice missing
                            </span>
                          ) : null}
                          {refunded ? (
                            <span className="rounded bg-blue-50 px-1.5 font-semibold text-[10.5px] text-blue-700 ring-1 ring-blue-600/15 ring-inset">
                              Refunded
                            </span>
                          ) : null}
                        </div>
                        <div className="text-gray-500 text-xs">{b.email}</div>
                      </td>
                      <td className="px-4 py-2.5">
                        <DayChips bookings={b.bookings} eventDates={eventDates} />
                      </td>
                      <td className="px-4 py-2.5 text-right tabular-nums">{b.bookingCount}</td>
                      <td className="px-4 py-2.5 text-right font-semibold tabular-nums">
                        {money(b.confirmedTotal, b.currency)}
                      </td>
                      <td className="px-4 py-2.5 text-right tabular-nums">
                        {onHold ? (
                          <span className="font-semibold text-amber-700">{money(onHold, b.currency)}</span>
                        ) : (
                          <span className="text-gray-300">—</span>
                        )}
                      </td>
                      <td className="px-2 py-2.5 text-gray-400">
                        <ChevronDown
                          className={`h-4 w-4 transition ${open ? "rotate-180" : ""}`}
                          aria-hidden
                        />
                      </td>
                    </tr>
                    {open ? (
                      <tr className="border-gray-100 border-b bg-[#000643]/[0.02]">
                        <td colSpan={6} className="px-4 pt-1 pb-3">
                          <table className="w-full rounded-lg border border-gray-200 bg-white text-left text-[13px]">
                            <thead className="text-[10.5px] text-gray-500 uppercase tracking-[0.05em]">
                              <tr className="border-gray-100 border-b">
                                <th className="px-3 py-2 font-semibold">Room</th>
                                <th className="px-3 py-2 font-semibold">When (TRT)</th>
                                <th className="px-3 py-2 font-semibold">Add-ons</th>
                                <th className="px-3 py-2 font-semibold">Status</th>
                                <th className="px-3 py-2 text-right font-semibold">Amount</th>
                                <th className="px-3 py-2 font-semibold">Document</th>
                              </tr>
                            </thead>
                            <tbody>
                              {b.bookings.map((bk) => (
                                <tr key={bk.uid} className="border-gray-100 border-b last:border-0">
                                  <td className="px-3 py-2 font-semibold text-[#000643]">{bk.roomName}</td>
                                  <td className="px-3 py-2 tabular-nums">
                                    {fmtDay(bk.startUtc)} · {fmtTime(bk.startUtc)}–{fmtTime(bk.endUtc)}
                                  </td>
                                  <td className="px-3 py-2 text-gray-600 text-xs">
                                    {bk.addOns.length === 0
                                      ? "—"
                                      : bk.addOns.map((a) => `${a.name} × ${a.quantity}`).join(", ")}
                                  </td>
                                  <td className="px-3 py-2">
                                    <StatusPill status={displayStatus(bk)} />
                                  </td>
                                  <td className="px-3 py-2 text-right tabular-nums">
                                    {money(bk.amountTotal, bk.currency)}
                                  </td>
                                  <td className="px-3 py-2">
                                    {bk.creditNoteNumber ? (
                                      <a
                                        href={`/rooms/credit-note/${bk.documentUid}`}
                                        target="_blank"
                                        rel="noreferrer"
                                        onClick={(e) => e.stopPropagation()}
                                        className="text-[#000643] underline decoration-[#000643]/30 underline-offset-2">
                                        {bk.creditNoteNumber}
                                      </a>
                                    ) : bk.invoiceNumber ? (
                                      <a
                                        href={`/rooms/invoice/${bk.documentUid}`}
                                        target="_blank"
                                        rel="noreferrer"
                                        onClick={(e) => e.stopPropagation()}
                                        className="text-[#000643] underline decoration-[#000643]/30 underline-offset-2">
                                        {bk.invoiceNumber}
                                      </a>
                                    ) : (
                                      <span className="text-gray-300">—</span>
                                    )}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </td>
                      </tr>
                    ) : null}
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

/**
 * Which of the three days this person holds a room on — the one-room-a-day rule
 * makes it the first thing the desk wants to know. Filled: confirmed. Hatched:
 * on hold. Blue: refunded. Struck: cancelled. Pale: nothing that day.
 */
function DayChips({
  bookings,
  eventDates,
}: {
  bookings: BookerBooking[];
  eventDates: string[];
}): JSX.Element {
  return (
    <span className="inline-flex gap-1">
      {eventDates.map((date) => {
        const onDay = bookings.filter((b) => dayKey(b.startUtc) === date);
        const statuses = onDay.map((b) => displayStatus(b));
        const label = new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", weekday: "short" }).format(
          new Date(`${date}T12:00:00Z`)
        );
        const base = "inline-block w-9 rounded border text-center font-semibold text-[10.5px] leading-[18px]";
        if (statuses.includes("CONFIRMED")) {
          return (
            <span
              key={date}
              className={`${base} border-[#000643] bg-[#000643] text-white`}
              title={`${label}: confirmed`}>
              {label}
            </span>
          );
        }
        if (statuses.includes("PENDING")) {
          return (
            <span
              key={date}
              className={`${base} border-amber-300 text-amber-950`}
              style={{ background: HATCH.held }}
              title={`${label}: on hold`}>
              {label}
            </span>
          );
        }
        if (statuses.includes("REFUNDED")) {
          return (
            <span
              key={date}
              className={`${base} border-blue-200 bg-blue-50 text-blue-700`}
              title={`${label}: refunded`}>
              {label}
            </span>
          );
        }
        if (statuses.includes("CANCELLED")) {
          return (
            <span
              key={date}
              className={`${base} border-gray-200 bg-white text-gray-400 line-through`}
              title={`${label}: cancelled`}>
              {label}
            </span>
          );
        }
        return (
          <span
            key={date}
            className={`${base} border-gray-200 bg-white text-gray-300`}
            title={`${label}: no room`}>
            {label}
          </span>
        );
      })}
    </span>
  );
}
