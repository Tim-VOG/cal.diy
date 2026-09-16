"use client";

import type { DayStats } from "@calcom/features/ne26-rooms/lib/dayStats";
import type { AttentionItem } from "@calcom/features/ne26-rooms/lib/needsAttention";
import { CalendarRange, Download, List } from "lucide-react";
import { useState } from "react";
import BookingSidePanel from "./BookingSidePanel";
import BookingsTable from "./BookingsTable";
import DayCards from "./DayCards";
import { fmtDayLong } from "./format";
import NeedsAttentionPanel from "./NeedsAttentionPanel";
import PlanView, { type PlanBlockedSlot, type PlanRoom } from "./PlanView";
import SummaryCards from "./SummaryCards";
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
  amountTotal: number;
  currency: string;
  stripePaymentId: string | null;
  orderRoomCount: number;
  orderUid: string | null;
  /** When the order was placed, and when it was paid — different questions. */
  orderedAt: string;
  paidAt: string | null;
  /** When a live hold lapses; null once paid or released. */
  holdExpiresAt: string | null;
  /** The uid the invoice and credit-note PDFs are stored under. */
  documentUid: string;
  invoiceNumber: string | null;
  creditNoteNumber: string | null;
  addOns: { name: string; quantity: number; lineTotal: number }[];
}

/**
 * The bookings home: what needs a person, then money and the three days, then
 * the rooms — as a plan to the minute, or as the list the desk exports from.
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
          href="/api/ne26-rooms/export/documents"
          className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 py-1.5 font-semibold text-[#000643] text-[13px] transition hover:border-[#000643]">
          <Download className="h-3.5 w-3.5" aria-hidden />
          All invoices (ZIP)
        </a>
      </header>

      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <NeedsAttentionPanel items={attention} />
        <SummaryCards
          rows={rows}
          soldHours={totals.sold}
          heldHours={totals.held}
          capacityHours={totals.capacity}
        />
      </div>

      <DayCards days={days} selectedDate={day?.date ?? ""} onSelect={setSelectedDate} currency={currency} />

      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-semibold text-[#000643] text-[15px]">
          {view === "plan" && day ? fmtDayLong(day.openUtc) : "All bookings"}
        </h2>
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
    </div>
  );
}
