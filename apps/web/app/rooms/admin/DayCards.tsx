"use client";

import type { CellState, DayStats } from "@calcom/features/ne26-rooms/lib/dayStats";
import { fmtDay, fmtHours, fmtMoney, fmtTime } from "./format";
import { HATCH } from "./ui";

const CELL: Record<CellState, React.CSSProperties> = {
  free: { background: "#eef0f5" },
  sold: { background: "#000643" },
  held: { background: HATCH.held },
  blocked: { background: "#cbd0db" },
};
/** Drawn in this order, so a sale always shows over a block it overlaps. */
const LAYER: Record<CellState, number> = { free: 0, blocked: 1, held: 2, sold: 3 };
const CELL_LABEL: Record<CellState, string> = {
  free: "free",
  sold: "sold",
  held: "on hold",
  blocked: "blocked",
};

/** "Small Room 2" → "S2", "Suite 1" → "Su1": enough to read a 9-row grid. */
export function roomShort(name: string): string {
  const words = name.split(" ");
  const last = words[words.length - 1];
  const number = /^\d+$/.test(last) ? last : "";
  const prefix = words.length > 2 ? words[0][0] : words[0].slice(0, 2);
  return `${prefix}${number}`;
}

/**
 * One card per event day — never more than three across, and there are three
 * days. Each is also how the plan below is switched to that day.
 */
export default function DayCards({
  days,
  selectedDate,
  onSelect,
  currency,
}: {
  days: DayStats[];
  selectedDate: string;
  onSelect: (date: string) => void;
  currency: string;
}): JSX.Element {
  return (
    <div className="grid gap-4 md:grid-cols-3" role="tablist" aria-label="Event day">
      {days.map((day) => {
        const selected = day.date === selectedDate;
        const pct = (h: number) => (day.capacityHours > 0 ? (h / day.capacityHours) * 100 : 0);
        const hours = day.grid[0]?.cells.length ?? 0;
        return (
          <button
            key={day.date}
            type="button"
            role="tab"
            aria-selected={selected}
            onClick={() => onSelect(day.date)}
            className={`flex h-full flex-col rounded-xl border bg-white p-4 text-left transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#000643]/40 ${
              selected ? "border-[#000643] ring-1 ring-[#000643]" : "border-gray-200 hover:border-gray-300"
            }`}>
            <div className="flex items-baseline justify-between gap-2">
              <span className="font-semibold text-[#000643] text-[15px]">{fmtDay(day.openUtc)}</span>
              <span className="text-gray-500 text-xs tabular-nums">
                {fmtTime(day.openUtc)}–{fmtTime(day.closeUtc)}
              </span>
            </div>

            <p className="mt-2">
              <span className="font-bold text-[#000643] text-[22px] tabular-nums">
                {fmtHours(day.soldHours)}
              </span>{" "}
              <span className="text-gray-500 text-sm">sold of {day.capacityHours}</span>
            </p>
            <div className="mt-2 flex h-1.5 overflow-hidden rounded-full bg-gray-100" aria-hidden>
              <span className="block h-full bg-[#000643]" style={{ width: `${pct(day.soldHours)}%` }} />
              <span
                className="block h-full"
                style={{ width: `${pct(day.heldHours)}%`, background: HATCH.held }}
              />
              <span className="block h-full bg-[#cbd0db]" style={{ width: `${pct(day.blockedHours)}%` }} />
            </div>
            <p className="mt-1 text-gray-500 text-xs tabular-nums">
              + {fmtHours(day.heldHours)} on hold · {fmtHours(day.blockedHours)} blocked
            </p>

            <div
              className="mt-3 grid grid-cols-[1.75rem_minmax(0,1fr)] items-center gap-x-1.5 gap-y-[3px]"
              role="img"
              aria-label={`Room occupancy by hour on ${fmtDay(day.openUtc)}`}>
              {day.grid.map((row, i) => (
                <div key={`${row.roomName}-${i}`} className="contents">
                  <span className="text-[10px] text-gray-500 leading-[9px]" title={row.roomName}>
                    {roomShort(row.roomName)}
                  </span>
                  <span className="relative block">
                    {/* The hours are the ruler; the bookings are drawn over it
                        to the minute, so a 10:15–11:15 hour reads as one. */}
                    <span
                      className="grid gap-[2px]"
                      style={{ gridTemplateColumns: `repeat(${hours}, minmax(0, 1fr))` }}>
                      {row.cells.map((_, i) => (
                        <i
                          // biome-ignore lint/suspicious/noArrayIndexKey: an hour's position is its identity
                          key={i}
                          className="block h-[9px] rounded-[2px]"
                          style={CELL.free}
                        />
                      ))}
                    </span>
                    {[...row.spans]
                      .sort((x, y) => LAYER[x.state] - LAYER[y.state])
                      .map((span, i) => (
                        <i
                          // biome-ignore lint/suspicious/noArrayIndexKey: spans do not move within a render
                          key={i}
                          className="absolute inset-y-0 block rounded-[2px]"
                          style={{
                            ...CELL[span.state],
                            left: `${span.from * 100}%`,
                            width: `${(span.to - span.from) * 100}%`,
                          }}
                          title={`${row.roomName}: ${CELL_LABEL[span.state]}`}
                        />
                      ))}
                  </span>
                </div>
              ))}
            </div>

            <div className="mt-3 mb-3 border-gray-100 border-t pt-3">
              <p className="font-semibold text-[11px] text-gray-500 uppercase tracking-[0.07em]">Catering</p>
              {day.catering.length === 0 ? (
                <p className="mt-1 text-gray-400 text-xs">None ordered</p>
              ) : (
                <ul className="mt-1 grid gap-0.5 text-xs">
                  {day.catering.map((c) => (
                    <li key={c.name} className="flex justify-between gap-2">
                      <span className="truncate">{c.name}</span>
                      <span className="shrink-0 tabular-nums">
                        {c.confirmed}
                        {c.held ? <span className="text-amber-700"> +{c.held} held</span> : null}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div className="mt-auto flex items-baseline justify-between border-gray-100 border-t pt-3 text-sm">
              <span className="text-gray-500">Confirmed revenue</span>
              <span className="font-bold tabular-nums">{fmtMoney(day.confirmedRevenue, currency)}</span>
            </div>
          </button>
        );
      })}
    </div>
  );
}
