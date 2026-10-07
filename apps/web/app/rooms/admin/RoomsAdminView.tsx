"use client";

import type { DayStats } from "@calcom/features/ne26-rooms/lib/dayStats";
import type { AttentionItem } from "@calcom/features/ne26-rooms/lib/needsAttention";
import { orderRef } from "@calcom/features/ne26-rooms/lib/orderRef";
import { CalendarRange, Download, List } from "lucide-react";
import { useState } from "react";
import BookingSidePanel from "./BookingSidePanel";
import BookingsTable from "./BookingsTable";
import DayCards from "./DayCards";
import { downloadWorkbook } from "./exports";
import { displayStatus, fmtDayLong, fmtTime } from "./format";
import NeedsAttentionPanel from "./NeedsAttentionPanel";
import PlanView, { type PlanBlockedSlot, type PlanRoom } from "./PlanView";
import { LatestOrders, SalesStrip } from "./SummaryCards";
import { useNow } from "./ui";

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
  /** The billing block, for the exports and the side panel. */
  bookerCompany: string | null;
  bookerVatNumber: string | null;
  bookerCountry: string | null;
  poNumber: string | null;
  internalReference: string | null;
  amountTotal: number;
  currency: string;
  stripePaymentId: string | null;
  orderRoomCount: number;
  orderUid: string | null;
  /** The number people quote — format with orderRef(). Null only for a room with no order. */
  orderNumber: number | null;
  /** When the order was placed, and when it was paid — different questions. */
  orderedAt: string;
  paidAt: string | null;
  /** When a live hold lapses; null once paid or released. */
  holdExpiresAt: string | null;
  /** The uid the invoice and credit-note PDFs are stored under. */
  documentUid: string;
  invoiceNumber: string | null;
  creditNoteNumber: string | null;
  /** What /rooms/credit-note is asked for: the note's number, or the order uid for old ones. */
  creditNoteUid: string | null;
  addOns: { name: string; quantity: number; lineTotal: number }[];
}

/**
 * The day the desk is looking at, as a sheet for the people working the floor:
 * who is in which room, when, and what they ordered. One row per booking, in
 * time order — the order a hostess reads it in, not the plan's room order.
 */
function exportDaySheet(day: DayStats, rows: AdminBookingRow[]): void {
  const inDay = rows
    .filter((r) => r.startUtc >= day.openUtc && r.startUtc < day.closeUtc && r.status !== "CANCELLED")
    .sort((a, b) => a.startUtc.localeCompare(b.startUtc) || a.roomName.localeCompare(b.roomName));
  downloadWorkbook({
    fileName: `ne26-day-${day.date}`,
    sheetName: "Day sheet",
    headers: [
      "Start (TRT)",
      "End",
      "Hours",
      "Room",
      "Company",
      "Contact",
      "Email",
      "Status",
      "Add-ons",
      "Order",
    ],
    rows: inDay.map((r) => [
      fmtTime(r.startUtc),
      fmtTime(r.endUtc),
      r.durationMinutes / 60,
      r.roomName,
      r.bookerCompany,
      r.bookerName,
      r.bookerEmail,
      displayStatus(r),
      r.addOns.map((a) => `${a.name} x${a.quantity}`).join("; "),
      r.orderNumber !== null ? orderRef(r.orderNumber) : "",
    ]),
  });
}

/**
 * The bookings home: money first, then what needs a person and the three days,
 * then the rooms — as a plan to the minute, or as the list the desk exports
 * from. The latest orders are a log and come last.
 */
export default function RoomsAdminView({
  rows,
  rooms,
  blocks,
  days,
  attention,
  bufferMinutes,
  todayLabel,
}: {
  rows: AdminBookingRow[];
  rooms: PlanRoom[];
  blocks: PlanBlockedSlot[];
  days: DayStats[];
  attention: AttentionItem[];
  bufferMinutes: number;
  /** "Wednesday 16 September · 10:45 TRT · 62 days to the event", computed on the server. */
  todayLabel: string;
}): JSX.Element {
  const now = useNow();
  const [view, setView] = useState<"plan" | "list">("plan");
  const [selectedDate, setSelectedDate] = useState(days[0]?.date ?? "");
  const [selectedUid, setSelectedUid] = useState<string | null>(null);
  const selected = selectedUid ? (rows.find((r) => r.uid === selectedUid) ?? null) : null;
  const day = days.find((d) => d.date === selectedDate) ?? days[0];
  const currency = rows[0]?.currency ?? "EUR";

  const totals = days.reduce(
    (t, d) => ({
      sold: t.sold + d.soldHours,
      held: t.held + d.heldHours,
      capacity: t.capacity + d.capacityHours,
    }),
    { sold: 0, held: 0, capacity: 0 }
  );

  const toggle = (on: boolean) =>
    `inline-flex items-center gap-1.5 rounded-md px-3 py-1 font-medium text-[13px] transition ${
      on ? "bg-[#000643] text-white" : "text-gray-700 hover:bg-gray-100"
    }`;

  return (
    <div className="grid gap-5">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="font-semibold text-[11px] text-gray-500 uppercase tracking-[0.07em]">{todayLabel}</p>
          <h1 className="mt-0.5 font-bold text-[#000643] text-2xl tracking-tight">Bookings</h1>
        </div>
        <a
          href="/api/ne26-rooms/export/accounting"
          className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 py-1.5 font-semibold text-[#000643] text-[13px] transition hover:border-[#000643]">
          <Download className="h-3.5 w-3.5" aria-hidden />
          Accounting (Excel)
        </a>
        <a
          href="/api/ne26-rooms/export/documents"
          className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 py-1.5 font-semibold text-[#000643] text-[13px] transition hover:border-[#000643]">
          <Download className="h-3.5 w-3.5" aria-hidden />
          All invoices (ZIP)
        </a>
      </header>

      <SalesStrip
        rows={rows}
        soldHours={totals.sold}
        heldHours={totals.held}
        capacityHours={totals.capacity}
      />

      <NeedsAttentionPanel items={attention} />

      <DayCards days={days} selectedDate={day?.date ?? ""} onSelect={setSelectedDate} currency={currency} />

      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-semibold text-[#000643] text-[15px]">
          {view === "plan" && day ? fmtDayLong(day.openUtc) : "All bookings"}
        </h2>
        <div className="flex flex-wrap items-center gap-2">
          {view === "plan" && day ? (
            <button
              type="button"
              onClick={() => exportDaySheet(day, rows)}
              className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 py-1.5 font-semibold text-[#000643] text-[13px] transition hover:border-[#000643]">
              <Download className="h-3.5 w-3.5" aria-hidden />
              Day sheet
            </button>
          ) : null}
          <div
            className="inline-flex gap-0.5 rounded-lg border border-gray-200 bg-white p-0.5"
            role="group"
            aria-label="View">
            <button
              type="button"
              onClick={() => setView("plan")}
              aria-pressed={view === "plan"}
              className={toggle(view === "plan")}>
              <CalendarRange className="h-3.5 w-3.5" aria-hidden />
              Plan
            </button>
            <button
              type="button"
              onClick={() => setView("list")}
              aria-pressed={view === "list"}
              className={toggle(view === "list")}>
              <List className="h-3.5 w-3.5" aria-hidden />
              List
            </button>
          </div>
        </div>
      </div>

      <div className={`grid items-start gap-4 ${selected ? "xl:grid-cols-[minmax(0,1fr)_20rem]" : ""}`}>
        <div className="min-w-0">
          {view === "plan" && day ? (
            <PlanView
              openUtc={day.openUtc}
              closeUtc={day.closeUtc}
              rooms={rooms}
              rows={rows}
              blocks={blocks}
              bufferMinutes={bufferMinutes}
              freeHours={Math.max(0, day.capacityHours - day.soldHours - day.heldHours - day.blockedHours)}
              selectedUid={selectedUid}
              onSelect={setSelectedUid}
              now={now}
            />
          ) : (
            <BookingsTable rows={rows} selectedUid={selectedUid} onSelect={setSelectedUid} now={now} />
          )}
        </div>
        {selected ? (
          <BookingSidePanel booking={selected} onClose={() => setSelectedUid(null)} now={now} />
        ) : null}
      </div>

      <LatestOrders rows={rows} />
    </div>
  );
}
