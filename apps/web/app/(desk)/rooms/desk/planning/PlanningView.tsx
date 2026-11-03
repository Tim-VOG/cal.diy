"use client";

import { eventToday, shiftDay } from "@calcom/features/ne26-rooms/lib/deskDay";
import { type PlanBlock, planLayout } from "@calcom/features/ne26-rooms/lib/planLayout";
import { byDoorName, roomDoorName, roomSoldName } from "@calcom/features/ne26-rooms/lib/roomNames";
import { trpc } from "@calcom/trpc/react";
import { ChevronLeft, ChevronRight, RefreshCw } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";

const HOUR_MS = 3_600_000;
const SLOT_MS = 15 * 60 * 1000;

/** Cleaning, holds and blocks, drawn the way the admin plan draws them. */
const HATCH = {
  held: "repeating-linear-gradient(135deg,#fde9bd 0 6px,#fdf3dd 6px 12px)",
  blocked: "repeating-linear-gradient(135deg,#e5e7eb 0 5px,#f3f4f6 5px 10px)",
  cleaning: "repeating-linear-gradient(135deg,#eceef3 0 4px,transparent 4px 9px)",
};

function hhmm(iso: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Istanbul",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(iso));
}

function dayLabel(date: string): string {
  const [y, m, d] = date.split("-").map(Number);
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "UTC",
    weekday: "long",
    day: "numeric",
    month: "long",
  }).format(new Date(Date.UTC(y, m - 1, d)));
}

interface PlanningBooking {
  uid: string;
  roomName: string;
  status: string;
  startUtc: string;
  endUtc: string;
  bookerName: string;
  company: string | null;
  isBlock: boolean;
  arrived: boolean;
}

/**
 * The whole day on one screen: every room down the side, the opening hours
 * across the top, each booking where it actually sits.
 *
 * Built on the same layout engine as the admin's plan, and deliberately looking
 * like it. The desk had a grid of 15-minute columns, which came to 1800 pixels
 * for a nine-hour day: on the counter tablet the afternoon sat off the
 * right-hand edge with nothing to say so, and an empty-looking screen reads as
 * an empty day. A proportional lane per room fits whatever width the tablet
 * has, and a booking is drawn to the minute rather than snapped to a column.
 *
 * The board answers "what is free this afternoon" and "who is in Meeting 3", so
 * each block leads with the company — that is what somebody standing at the
 * counter says first — with the person's name underneath.
 */
export default function PlanningView(): JSX.Element {
  // Opens on the event's first day until the event is actually running, rather
  // than on a today that is months away from any booking.
  const eventDays = trpc.viewer.rooms.deskEventDays.useQuery();
  const [chosen, setChosen] = useState<string | null>(null);
  const date = chosen ?? eventDays.data?.defaultDate ?? eventToday();
  const setDate = (next: string | ((d: string) => string)) =>
    setChosen((current) => {
      const from = current ?? eventDays.data?.defaultDate ?? eventToday();
      return typeof next === "function" ? next(from) : next;
    });
  // The board is left open on the counter all day, so it has to keep itself
  // current: a hostess reading a stale grid sells a room that went ten minutes
  // ago. Polling also keeps the "now" line honest as the day moves.
  const planning = trpc.viewer.rooms.deskPlanning.useQuery(
    { date },
    { refetchInterval: 30_000, refetchOnWindowFocus: true, refetchOnMount: "always" }
  );

  const openUtc = planning.data?.openUtc ?? null;
  const closeUtc = planning.data?.closeUtc ?? null;
  const bufferMinutes = planning.data?.bufferMinutes ?? 0;
  const nowMs = planning.data ? new Date(planning.data.nowUtc).getTime() : 0;
  const payloadRooms = planning.data?.rooms;
  const payloadBookings = planning.data?.bookings;

  // Down the side in door order, which is not the order they are stored in.
  const rooms = useMemo(() => [...(payloadRooms ?? [])].sort(byDoorName), [payloadRooms]);

  const bookings: PlanningBooking[] = useMemo(
    () =>
      (payloadBookings ?? []).map((b) => ({
        uid: b.uid,
        roomName: b.resource.name,
        status: b.isBlock ? "BLOCKED" : b.status,
        startUtc: new Date(b.startTime as unknown as string).toISOString(),
        endUtc: new Date(b.endTime as unknown as string).toISOString(),
        bookerName: b.bookerName,
        company: b.order?.bookerLegalName ?? null,
        isBlock: b.isBlock,
        arrived: Boolean(b.checkedInAt),
      })),
    [payloadBookings]
  );

  const layout = useMemo(() => {
    if (!openUtc || !closeUtc) return [];
    return planLayout<PlanningBooking>({
      bookings,
      roomNames: rooms.map((r) => r.name),
      openUtc: new Date(openUtc),
      closeUtc: new Date(closeUtc),
      bufferMinutes,
    });
  }, [bookings, rooms, openUtc, closeUtc, bufferMinutes]);

  const open = openUtc ? new Date(openUtc).getTime() : 0;
  const close = closeUtc ? new Date(closeUtc).getTime() : 0;
  const hours = close > open ? Math.max(1, Math.round((close - open) / HOUR_MS)) : 0;
  const ticks = hours
    ? Array.from({ length: hours + 1 }, (_, i) => new Date(open + i * HOUR_MS).toISOString())
    : [];
  const gridLines = {
    backgroundImage: "linear-gradient(to right, #eceef3 1px, transparent 1px)",
    backgroundSize: `calc(100% / ${hours || 1}) 100%`,
  };
  /** Where "now" falls across the day, or null when it is not inside it. */
  const nowPct = hours && nowMs > open && nowMs < close ? ((nowMs - open) / (close - open)) * 100 : null;

  // Before the event, "Today" would land on an empty August day. Send them back
  // to the event instead — that is what they meant.
  const home = eventDays.data?.defaultDate ?? eventToday();
  const atHome = date === home;

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => setDate((d) => shiftDay(d, -1))}
            aria-label="Previous day"
            className="rounded-lg border border-gray-200 bg-white p-2.5 text-[#000643] transition hover:border-[#000643]">
            <ChevronLeft className="h-5 w-5" aria-hidden />
          </button>
          <button
            type="button"
            onClick={() => setDate((d) => shiftDay(d, 1))}
            aria-label="Next day"
            className="rounded-lg border border-gray-200 bg-white p-2.5 text-[#000643] transition hover:border-[#000643]">
            <ChevronRight className="h-5 w-5" aria-hidden />
          </button>
          {atHome ? null : (
            <button
              type="button"
              onClick={() => setDate(home)}
              className="ml-1 rounded-lg border border-gray-200 bg-white px-3 py-2 font-medium text-[#000643] text-sm transition hover:border-[#000643]">
              {home === eventToday() ? "Today" : "Back to the event"}
            </button>
          )}
        </div>
        <button
          type="button"
          onClick={() => void planning.refetch()}
          disabled={planning.isFetching}
          className="flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 py-2 text-gray-600 text-xs transition hover:border-[#000643] hover:text-[#000643] disabled:opacity-50">
          <RefreshCw className={`h-3.5 w-3.5 ${planning.isFetching ? "animate-spin" : ""}`} aria-hidden />
          {planning.isFetching
            ? "Refreshing…"
            : planning.data
              ? `Updated ${hhmm(planning.data.nowUtc)}`
              : "Refresh"}
        </button>
      </div>

      <div className="mt-4">
        <h1 className="font-bold text-2xl text-[#000643]">{dayLabel(date)}</h1>
        <p className="mt-1 text-gray-600 text-sm">
          Tap any free time to start a booking for it. Times are Istanbul time.
        </p>
      </div>

      {planning.isPending ? (
        <p className="mt-6 text-gray-500 text-sm">Loading…</p>
      ) : !hours ? (
        <p className="mt-6 rounded-xl border border-gray-200 bg-white px-4 py-8 text-center text-gray-500 text-sm">
          The rooms are not open on this day.
        </p>
      ) : (
        <div className="mt-5 rounded-xl border border-gray-200 bg-white">
          <div className="overflow-x-auto px-3 pt-3 pb-4 sm:px-4">
            <div className="min-w-[32rem]">
              <div className="grid grid-cols-[6.5rem_minmax(0,1fr)] sm:grid-cols-[8.5rem_minmax(0,1fr)]">
                {/* A real grid cell: an absolutely positioned first child drops
                    out of the grid and collapses the hour labels into the room
                    column. */}
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
                      {hhmm(t)}
                    </span>
                  ))}
                </div>
              </div>

              {rooms.map((room, i) => (
                <div
                  key={room.slug}
                  className="grid grid-cols-[6.5rem_minmax(0,1fr)] border-gray-100 border-b last:border-0 sm:grid-cols-[8.5rem_minmax(0,1fr)]">
                  <div className="py-2 pr-3">
                    <p className="font-semibold text-[#000643] text-[13px] leading-tight">
                      {roomDoorName(room)}
                    </p>
                    <p className="truncate text-[10.5px] text-gray-400 uppercase tracking-wide">
                      {roomSoldName(room) ? `${roomSoldName(room)} · ` : ""}
                      {room.capacity}
                    </p>
                  </div>
                  <div className="relative h-12" style={gridLines}>
                    <FreeTime
                      blocks={layout[i]?.blocks ?? []}
                      room={{ slug: room.slug, label: roomDoorName(room) }}
                      date={date}
                      open={open}
                      close={close}
                      nowMs={nowMs}
                    />
                    {(layout[i]?.blocks ?? []).map((block) => (
                      <BookingBlock key={block.booking.uid} block={block} />
                    ))}
                    {nowPct === null ? null : (
                      <span
                        className="absolute inset-y-0 z-[2] w-px bg-red-500"
                        style={{ left: `${nowPct}%` }}
                        aria-hidden
                      />
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 border-gray-100 border-t px-4 py-2.5 text-gray-600 text-xs">
            <Legend style={{ background: "#e9ebf7", border: "1px solid #c9cde8" }} label="Booked" />
            <Legend style={{ background: HATCH.held, border: "1px solid #f5c46b" }} label="Held, unpaid" />
            <Legend style={{ background: HATCH.blocked, border: "1px solid #d1d5db" }} label="Blocked" />
            <Legend style={{ background: HATCH.cleaning }} label={`${bufferMinutes}-min cleaning`} />
            <Legend style={{ background: "#fff", border: "1px solid #e5e7eb" }} label="Free — tap to book" />
          </div>
        </div>
      )}
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

/**
 * The gaps between bookings, each one a link that starts a booking when the
 * room is next free.
 *
 * The old grid made every 15-minute cell clickable, which is how a hostess
 * could send herself to a start time the form then refused to show. A gap is
 * the honest unit, and its start is rounded up to the quarter hour the slot
 * grid is actually held in.
 */
function FreeTime({
  blocks,
  room,
  date,
  open,
  close,
  nowMs,
}: {
  blocks: PlanBlock<PlanningBooking>[];
  room: { slug: string; label: string };
  date: string;
  open: number;
  close: number;
  nowMs: number;
}): JSX.Element {
  const span = close - open;
  const taken = blocks
    .map((b) => ({ from: b.left, to: b.left + b.width + b.cleaningWidth }))
    .sort((a, b) => a.from - b.from);

  const gaps: { from: number; to: number }[] = [];
  let cursor = 0;
  for (const t of taken) {
    if (t.from > cursor) gaps.push({ from: cursor, to: Math.min(t.from, 100) });
    cursor = Math.max(cursor, t.to);
  }
  if (cursor < 100) gaps.push({ from: cursor, to: 100 });

  return (
    <>
      {gaps.map((g) => {
        const slot = Math.ceil((open + (g.from / 100) * span) / SLOT_MS) * SLOT_MS;
        const past = slot < nowMs;
        if (slot >= close || past) {
          return (
            <span
              key={g.from}
              className="absolute inset-y-0 bg-gray-50/70"
              style={{ left: `${g.from}%`, width: `${g.to - g.from}%` }}
              aria-hidden
            />
          );
        }
        const startIso = new Date(slot).toISOString();
        return (
          <Link
            key={g.from}
            href={`/rooms/desk/new?slug=${room.slug}&date=${date}&start=${encodeURIComponent(startIso)}`}
            aria-label={`Book ${room.label} from ${hhmm(startIso)}`}
            className="absolute inset-y-1.5 rounded-md transition hover:bg-[#000643]/10"
            style={{ left: `${g.from}%`, width: `calc(${g.to - g.from}% - 2px)` }}
          />
        );
      })}
    </>
  );
}

function BookingBlock({ block }: { block: PlanBlock<PlanningBooking> }): JSX.Element {
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

  if (b.isBlock) {
    return (
      <>
        <span
          className="absolute top-1.5 bottom-1.5 z-[1] overflow-hidden rounded-md px-2 py-1 text-gray-600"
          style={{ ...position, background: HATCH.blocked, border: "1px solid #d1d5db" }}
          title={`Blocked ${hhmm(b.startUtc)}–${hhmm(b.endUtc)}`}>
          <span className="block truncate font-semibold text-[11.5px] leading-tight">Blocked</span>
          <span className="block truncate text-[10.5px] tabular-nums">
            {hhmm(b.startUtc)}–{hhmm(b.endUtc)}
          </span>
        </span>
        {cleaning}
      </>
    );
  }

  const held = b.status === "PENDING";
  /** Roughly an hour on a nine-hour day: nothing fits beside the company. */
  const narrow = block.width < 14;
  const style: React.CSSProperties = held
    ? { background: HATCH.held, border: "1px solid #f5c46b" }
    : { background: "#e9ebf7", border: "1px solid #c9cde8" };
  if (block.conflict) style.border = "2px solid #dc2626";

  return (
    <>
      <span
        className={`absolute top-1.5 bottom-1.5 z-[1] overflow-hidden rounded-md px-2 py-1 ${
          held ? "text-amber-950" : "text-[#000643]"
        }`}
        style={{ ...position, ...style }}
        title={`${b.company ? `${b.company} — ` : ""}${b.bookerName} · ${hhmm(b.startUtc)}–${hhmm(
          b.endUtc
        )}${held ? " · held, unpaid" : ""}${b.arrived ? " · arrived" : ""}`}>
        {/* The company leads: it is what somebody at the counter says first.
            A one-hour block is a ninth of the day, too narrow for two lines of
            anything — so it spends both of them on the company rather than
            truncating it to "Tel…" and adding a name nobody can read either. */}
        <span
          className={`block font-semibold text-[11.5px] leading-tight ${
            narrow ? "line-clamp-2" : "truncate"
          }`}>
          {b.arrived ? "✓ " : ""}
          {b.company || b.bookerName}
        </span>
        {narrow ? null : (
          <span className="block truncate text-[10.5px] opacity-80">
            {held ? "Held, unpaid" : b.company ? b.bookerName : hhmm(b.startUtc)}
          </span>
        )}
      </span>
      {cleaning}
    </>
  );
}
