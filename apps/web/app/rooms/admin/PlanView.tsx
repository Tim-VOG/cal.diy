"use client";

import { orderRef } from "@calcom/features/ne26-rooms/lib/orderRef";
import { type PlanBlock, planLayout } from "@calcom/features/ne26-rooms/lib/planLayout";
import { AlertTriangle } from "lucide-react";
import { useMemo } from "react";
import { fmtCountdown, fmtDayLong, fmtHours, fmtTime } from "./format";
import type { AdminBookingRow } from "./RoomsAdminView";
import { HATCH } from "./ui";

export interface PlanRoom {
  name: string;
  category: string;
  capacity: number;
}
export interface PlanBlockedSlot {
  uid: string;
  roomName: string;
  startUtc: string;
  endUtc: string;
}

type Item = AdminBookingRow | (PlanBlockedSlot & { status: "BLOCKED" });
const isBlocked = (b: Item): b is PlanBlockedSlot & { status: "BLOCKED" } => b.status === "BLOCKED";

/**
 * The rooms × hours plan for one day, every booking where it really sits.
 *
 * Positioned to the minute by lib/planLayout, so the chained starts — 10:15,
 * 11:30 — are drawn instead of silently skipped, and the 15-minute cleaning gap
 * after each booking is visible as the gap it is.
 */
export default function PlanView({
  openUtc,
  closeUtc,
  rooms,
  rows,
  blocks,
  bufferMinutes,
  freeHours,
  selectedUid,
  onSelect,
  now,
}: {
  openUtc: string;
  closeUtc: string;
  rooms: PlanRoom[];
  rows: AdminBookingRow[];
  blocks: PlanBlockedSlot[];
  bufferMinutes: number;
  freeHours: number;
  selectedUid: string | null;
  onSelect: (uid: string) => void;
  now: Date | null;
}): JSX.Element {
  const open = new Date(openUtc);
  const close = new Date(closeUtc);
  const hours = Math.round((close.getTime() - open.getTime()) / 3_600_000);
  const roomNames = rooms.map((r) => r.name);

  const layout = useMemo(() => {
    const bookings = planLayout({ bookings: rows, roomNames, openUtc: open, closeUtc: close, bufferMinutes });
    const blocked = planLayout<Item>({
      bookings: blocks.map((b) => ({ ...b, status: "BLOCKED" as const })),
      roomNames,
      openUtc: open,
      closeUtc: close,
      // A blocked slot is not cleaned after.
      bufferMinutes: 0,
    });
    return bookings.map((row, i) => ({
      roomName: row.roomName,
      blocks: [...(row.blocks as PlanBlock<Item>[]), ...blocked[i].blocks],
    }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, blocks, openUtc, closeUtc, bufferMinutes, roomNames.join("|")]);

  const ticks = Array.from({ length: hours + 1 }, (_, i) =>
    new Date(open.getTime() + i * 3_600_000).toISOString()
  );
  const gridLines = {
    backgroundImage: "linear-gradient(to right, #eceef3 1px, transparent 1px)",
    backgroundSize: `calc(100% / ${hours}) 100%`,
  };

  return (
    <div
      className="rounded-xl border border-gray-200 bg-white"
      aria-label={`Plan for ${fmtDayLong(openUtc)}`}
      role="region">
      <div className="overflow-x-auto px-4 pt-3 pb-4">
        <div className="min-w-[46rem]">
          <div className="grid grid-cols-[8.5rem_minmax(0,1fr)]">
            {/* A real grid cell, not an sr-only one: an absolutely positioned
                first child drops out of the grid and the hour labels collapse
                into the room-name column. */}
            <span aria-hidden />
            <div className="relative h-5" aria-hidden>
              {ticks.map((t, i) => (
                <span
                  key={t}
                  className="absolute text-[11px] text-gray-500 tabular-nums"
                  style={{
                    left: `${(i / hours) * 100}%`,
                    transform: i === 0 ? "none" : i === hours ? "translateX(-100%)" : "translateX(-50%)",
                  }}>
                  {fmtTime(t)}
                </span>
              ))}
            </div>
          </div>

          {rooms.map((room, i) => (
            <div
              key={`${room.name}-${i}`}
              className="grid grid-cols-[8.5rem_minmax(0,1fr)] border-gray-100 border-b last:border-0">
              <div className="py-2 pr-3">
                <p className="font-semibold text-[#000643] text-[13px] leading-tight">{room.name}</p>
                <p className="text-[10.5px] text-gray-400 uppercase tracking-wide">
                  {room.category} · {room.capacity}
                </p>
              </div>
              <div className="relative h-12" style={gridLines}>
                {layout[i].blocks.map((block) => (
                  <PlanBlockView
                    key={block.booking.uid}
                    block={block}
                    selected={block.booking.uid === selectedUid}
                    onSelect={onSelect}
                    now={now}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 border-gray-100 border-t px-4 py-2.5 text-gray-600 text-xs">
        <Legend style={{ background: "#e9ebf7", border: "1px solid #c9cde8" }} label="Confirmed" />
        <Legend style={{ background: HATCH.held, border: "1px solid #f5c46b" }} label="Hold (35 min)" />
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-full bg-amber-500" aria-hidden />
          Invoice missing
        </span>
        <Legend style={{ background: HATCH.blocked, border: "1px solid #d1d5db" }} label="Blocked slot" />
        <Legend style={{ background: HATCH.cleaning }} label={`${bufferMinutes}-min cleaning`} />
        <span className="ml-auto tabular-nums">{fmtHours(freeHours)} of room time still free</span>
      </div>
    </div>
  );
}

function Legend({ style, label }: { style: React.CSSProperties; label: string }): JSX.Element {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="inline-block h-2.5 w-4 rounded-[3px]" style={style} aria-hidden />
      {label}
    </span>
  );
}

function PlanBlockView({
  block,
  selected,
  onSelect,
  now,
}: {
  block: PlanBlock<Item>;
  selected: boolean;
  onSelect: (uid: string) => void;
  now: Date | null;
}): JSX.Element {
  const b = block.booking;
  const position = { left: `${block.left}%`, width: `calc(${block.width}% - 2px)` };
  const cleaning =
    block.cleaningWidth > 0 ? (
      <span
        title="Cleaning"
        className="absolute top-1.5 bottom-1.5 rounded-[3px]"
        style={{
          left: `${block.left + block.width}%`,
          width: `${block.cleaningWidth}%`,
          background: HATCH.cleaning,
        }}
        aria-hidden
      />
    ) : null;

  if (isBlocked(b)) {
    return (
      <span
        className="absolute top-1.5 bottom-1.5 overflow-hidden rounded-md px-2 py-1 text-gray-600"
        style={{ ...position, background: HATCH.blocked, border: "1px solid #d1d5db" }}
        title={`Blocked ${fmtTime(b.startUtc)}–${fmtTime(b.endUtc)}`}>
        <span className="block truncate font-semibold text-[11.5px] leading-tight">Blocked</span>
        <span className="block truncate text-[10.5px] tabular-nums">
          {fmtTime(b.startUtc)}–{fmtTime(b.endUtc)}
        </span>
      </span>
    );
  }

  const held = b.status === "PENDING";
  const invoiceMissing = b.status === "CONFIRMED" && Boolean(b.orderUid) && !b.invoiceNumber;
  const msLeft = held && b.holdExpiresAt && now ? new Date(b.holdExpiresAt).getTime() - now.getTime() : null;
  const second = held
    ? `Hold${msLeft !== null ? ` · ${fmtCountdown(msLeft)}` : ""}`
    : b.orderNumber !== null
      ? `${orderRef(b.orderNumber)}${b.invoiceNumber ? "" : " · no invoice"}`
      : (b.invoiceNumber ?? "");

  const style: React.CSSProperties = held
    ? { background: HATCH.held, border: "1px solid #f5c46b" }
    : { background: "#e9ebf7", border: "1px solid #c9cde8" };
  if (block.conflict) style.border = "2px solid #dc2626";

  return (
    <>
      <button
        type="button"
        onClick={() => onSelect(b.uid)}
        aria-pressed={selected}
        title={`${b.roomName} · ${fmtTime(b.startUtc)}–${fmtTime(b.endUtc)} · ${b.bookerName}`}
        className={`absolute top-1.5 bottom-1.5 z-[1] overflow-hidden rounded-md px-2 py-1 text-left transition focus-visible:outline-none ${
          held ? "text-amber-950" : "text-[#000643]"
        } ${selected ? "z-[2] ring-2 ring-[#000643] ring-offset-2" : "hover:brightness-[0.97]"}`}
        style={{ ...position, ...style }}>
        <span className="flex items-center gap-1 truncate font-semibold text-[11.5px] leading-tight">
          {block.conflict ? (
            <AlertTriangle className="h-3 w-3 shrink-0 text-red-600" aria-label="Overlap" />
          ) : null}
          {invoiceMissing ? (
            <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-amber-500" aria-hidden />
          ) : null}
          <span className="truncate">{b.bookerName}</span>
        </span>
        <span className="block truncate text-[10.5px] tabular-nums opacity-80">{second}</span>
      </button>
      {cleaning}
    </>
  );
}
