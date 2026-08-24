"use client";

import { brusselsToday, shiftDay } from "@calcom/features/ne26-rooms/lib/deskDay";
import { trpc } from "@calcom/trpc/react";
import { ChevronLeft, ChevronRight, RefreshCw } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

const SLOT_MS = 15 * 60 * 1000;

function hhmm(iso: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Brussels",
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

type Cell =
  | { kind: "free" }
  | { kind: "cleaning" }
  | { kind: "booked"; label: string; held: boolean; block: boolean; first: boolean; arrived: boolean };

/**
 * The whole event on one screen: every room down the side, the day across the
 * top, at the 15-minute resolution the rooms are actually held in.
 *
 * Built for a laptop at the back of the desk rather than the tablet at the
 * front. The tablet answers "who is arriving now"; this answers "what is free
 * this afternoon" — which is the question asked when someone is standing there
 * wanting a room, and the one the day list cannot show.
 */
export default function PlanningView(): JSX.Element {
  // Opens on the event's first day until the event is actually running, rather
  // than on a today that is months away from any booking.
  const eventDays = trpc.viewer.rooms.deskEventDays.useQuery();
  const [chosen, setChosen] = useState<string | null>(null);
  const date = chosen ?? eventDays.data?.defaultDate ?? brusselsToday();
  const setDate = (next: string | ((d: string) => string)) =>
    setChosen((current) => {
      const from = current ?? eventDays.data?.defaultDate ?? brusselsToday();
      return typeof next === "function" ? next(from) : next;
    });
  // The board is left open on a laptop for the whole day, so it has to keep
  // itself current: a hostess reading a stale grid sells a room that went ten
  // minutes ago. Polling also keeps the "past" shading honest as the day moves.
  const planning = trpc.viewer.rooms.deskPlanning.useQuery(
    { date },
    { refetchInterval: 30_000, refetchOnWindowFocus: true, refetchOnMount: "always" }
  );

  const marks = planning.data?.slotMarksUtc ?? [];
  const rooms = planning.data?.rooms ?? [];
  const bookings = planning.data?.bookings ?? [];
  const bufferMs = (planning.data?.bufferMinutes ?? 0) * 60 * 1000;
  const nowMs = planning.data ? new Date(planning.data.nowUtc).getTime() : 0;

  /** What occupies one room at one 15-minute mark. */
  function cellFor(slug: string, markMs: number): Cell {
    for (const b of bookings) {
      if (b.resource.slug !== slug) continue;
      const start = new Date(b.startTime as unknown as string).getTime();
      const end = new Date(b.endTime as unknown as string).getTime();
      if (markMs >= start && markMs < end) {
        return {
          kind: "booked",
          label: b.isBlock ? "Blocked" : b.bookerName,
          held: b.status === "PENDING",
          block: b.isBlock,
          first: markMs === start,
          arrived: Boolean(b.checkedInAt),
        };
      }
      // The cleaning gap belongs to the booking before it, and is drawn apart so
      // nobody reads an empty-looking room as sellable.
      if (bufferMs > 0 && markMs >= end && markMs < end + bufferMs) return { kind: "cleaning" };
    }
    return { kind: "free" };
  }

  // Before the event, "Today" would land on an empty August day. Send them back
  // to the event instead — that is what they meant.
  const home = eventDays.data?.defaultDate ?? brusselsToday();
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
          {!atHome ? (
            <button
              type="button"
              onClick={() => setDate(home)}
              className="ml-1 rounded-lg border border-gray-200 bg-white px-3 py-2 font-medium text-[#000643] text-sm transition hover:border-[#000643]">
              {home === brusselsToday() ? "Today" : "Back to the event"}
            </button>
          ) : null}
        </div>

        <div className="flex flex-wrap items-center gap-4 text-gray-600 text-xs">
          <span className="flex items-center gap-1.5">
            <span className="h-3 w-3 rounded-sm border border-gray-200 bg-white" aria-hidden />
            Free
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-3 w-3 rounded-sm bg-[#000643]" aria-hidden />
            Booked
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-3 w-3 rounded-sm bg-amber-400" aria-hidden />
            Held, unpaid
          </span>
          <span className="flex items-center gap-1.5">
            <span
              className="h-3 w-3 rounded-sm bg-gray-200 bg-[repeating-linear-gradient(45deg,transparent,transparent_2px,rgba(0,0,0,0.25)_2px,rgba(0,0,0,0.25)_4px)]"
              aria-hidden
            />
            Cleaning
          </span>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-bold text-2xl text-[#000643]">{dayLabel(date)}</h1>
          <p className="mt-1 text-gray-600 text-sm">
            Click any free slot to start a booking for it. Times are Brussels time.
          </p>
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

      {planning.isPending ? (
        <p className="mt-6 text-gray-500 text-sm">Loading…</p>
      ) : !marks.length ? (
        <p className="mt-6 rounded-xl border border-gray-200 bg-white px-4 py-8 text-center text-gray-500 text-sm">
          The rooms are not open on this day.
        </p>
      ) : (
        <div className="mt-5 overflow-x-auto rounded-xl border border-gray-200 bg-white">
          <table className="w-full border-collapse text-xs">
            <thead>
              <tr>
                <th className="sticky left-0 z-10 border-gray-200 border-r border-b bg-white px-3 py-2 text-left font-medium text-gray-500">
                  Room
                </th>
                {marks.map((mark) => {
                  const onTheHour = hhmm(mark).endsWith(":00");
                  return (
                    <th
                      key={mark}
                      className={`min-w-[2.75rem] border-gray-200 border-b px-0 py-2 font-medium text-[10px] ${
                        onTheHour ? "border-gray-300 border-l text-gray-600" : "text-transparent"
                      }`}>
                      {onTheHour ? hhmm(mark) : "·"}
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {rooms.map((room) => (
                <tr key={room.slug}>
                  <th className="sticky left-0 z-10 whitespace-nowrap border-gray-200 border-r border-b bg-white px-3 py-2 text-left font-medium text-[#000643]">
                    {room.name}
                  </th>
                  {marks.map((mark) => {
                    const markMs = new Date(mark).getTime();
                    const cell = cellFor(room.slug, markMs);
                    const past = markMs < nowMs;
                    const onTheHour = hhmm(mark).endsWith(":00");
                    const edge = onTheHour ? "border-gray-300 border-l" : "";

                    if (cell.kind === "booked") {
                      const tone = cell.block
                        ? "bg-gray-500 text-white"
                        : cell.held
                          ? "bg-amber-400 text-amber-950"
                          : "bg-[#000643] text-white";
                      return (
                        <td
                          key={mark}
                          title={`${cell.label}${cell.held ? " — held, unpaid" : ""}${
                            cell.arrived ? " — arrived" : ""
                          }`}
                          className={`h-9 border-gray-200 border-b ${edge} ${tone} px-1`}>
                          {cell.first ? (
                            <span className="block truncate font-medium">
                              {cell.arrived ? "✓ " : ""}
                              {cell.label}
                            </span>
                          ) : null}
                        </td>
                      );
                    }

                    if (cell.kind === "cleaning") {
                      return (
                        <td
                          key={mark}
                          title="Cleaning"
                          className={`h-9 border-gray-200 border-b ${edge} bg-gray-200 bg-[repeating-linear-gradient(45deg,transparent,transparent_2px,rgba(0,0,0,0.25)_2px,rgba(0,0,0,0.25)_4px)]`}
                        />
                      );
                    }

                    return (
                      <td key={mark} className={`h-9 border-gray-200 border-b p-0 ${edge}`}>
                        {past ? (
                          <span className="block h-full w-full bg-gray-50" aria-hidden />
                        ) : (
                          <Link
                            href={`/rooms/desk/new?slug=${room.slug}&date=${date}&start=${encodeURIComponent(mark)}`}
                            aria-label={`Book ${room.name} at ${hhmm(mark)}`}
                            className="block h-full w-full transition hover:bg-[#000643]/10"
                          />
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
