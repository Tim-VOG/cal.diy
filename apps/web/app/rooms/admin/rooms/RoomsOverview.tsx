"use client";

import { EyeOff, Users } from "lucide-react";
import { fmtMoney } from "../format";
import { HATCH } from "../ui";
import type { RoomRow } from "./RoomsManager";

export interface RoomDayOccupancy {
  /** "Tue" */
  label: string;
  soldHours: number;
  heldHours: number;
  blockedHours: number;
  capacityHours: number;
}

function discount(hourly: number, total: number, hours: number): string | null {
  if (hourly <= 0 || total <= 0) return null;
  const pct = Math.round(((hourly * hours - total) / (hourly * hours)) * 100);
  return pct > 0 ? `−${pct}%` : null;
}

const fmtH = (h: number) => (Number.isInteger(h) ? `${h}` : h.toFixed(1));

/**
 * All nine rooms at once: price grid, visibility and how full each day is.
 *
 * The category tabs are where a room is edited, one card per room; this is where
 * the rooms are compared — the question behind most visits to this page. Three
 * across, never more.
 */
export default function RoomsOverview({
  rooms,
  occupancy,
  onEdit,
}: {
  rooms: RoomRow[];
  occupancy: Record<string, RoomDayOccupancy[]>;
  onEdit: (room: RoomRow) => void;
}): JSX.Element {
  return (
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
      {rooms.map((r) => {
        const days = occupancy[r.name] ?? [];
        return (
          <article
            key={r.id}
            className={`flex flex-col rounded-xl border border-gray-200 p-4 ${r.isActive ? "bg-white" : "bg-gray-50"}`}>
            <header className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <h3 className="truncate font-semibold text-[#000643] text-[15px]">{r.name}</h3>
                <p className="mt-0.5 flex items-center gap-1.5 text-[11px] text-gray-500 uppercase tracking-wide">
                  {r.category}
                  <span aria-hidden>·</span>
                  <Users className="h-3 w-3" aria-hidden />
                  {r.capacity}
                  <span aria-hidden>·</span>
                  {r.surface} m²
                </p>
              </div>
              {r.isActive ? (
                <span className="inline-flex items-center gap-1.5 rounded-full bg-green-50 px-2 py-0.5 font-semibold text-[11px] text-green-700 ring-1 ring-green-600/15 ring-inset">
                  <span className="h-1.5 w-1.5 rounded-full bg-current" aria-hidden />
                  On sale
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 rounded-full bg-gray-100 px-2 py-0.5 font-semibold text-[11px] text-gray-500 ring-1 ring-gray-500/10 ring-inset">
                  <EyeOff className="h-3 w-3" aria-hidden />
                  Hidden
                </span>
              )}
            </header>

            <dl className="mt-3 grid grid-cols-3 gap-2">
              {([1, 2, 3] as const).map((h) => {
                const price = h === 1 ? r.price1h : h === 2 ? r.price2h : r.price3h;
                const off = h === 1 ? null : discount(r.price1h, price, h);
                return (
                  <div key={h} className="rounded-lg bg-gray-50 px-2.5 py-2">
                    <dt className="flex items-baseline justify-between text-[11px] text-gray-500">
                      {h} h{off ? <span className="font-semibold text-green-700">{off}</span> : null}
                    </dt>
                    <dd className="mt-0.5 font-semibold text-[#000643] text-sm tabular-nums">
                      {fmtMoney(price, r.currency).replace(/\.00$/, "")}
                    </dd>
                  </div>
                );
              })}
            </dl>

            <div className="mt-3">
              <p className="font-semibold text-[11px] text-gray-500 uppercase tracking-[0.07em]">
                Booked per day
              </p>
              <ul className="mt-1.5 grid gap-1.5">
                {days.map((d) => {
                  const pct = (x: number) => (d.capacityHours ? (x / d.capacityHours) * 100 : 0);
                  return (
                    <li
                      key={d.label}
                      className="grid grid-cols-[2.25rem_minmax(0,1fr)_3.5rem] items-center gap-2 text-xs">
                      <span className="text-gray-600">{d.label}</span>
                      <span
                        className="flex h-2 overflow-hidden rounded-full bg-gray-100"
                        role="img"
                        aria-label={`${d.label}: ${d.soldHours} of ${d.capacityHours} hours sold, ${d.heldHours} on hold, ${d.blockedHours} blocked`}>
                        <span
                          className="block h-full bg-[#000643]"
                          style={{ width: `${pct(d.soldHours)}%` }}
                        />
                        <span
                          className="block h-full"
                          style={{ width: `${pct(d.heldHours)}%`, background: HATCH.held }}
                        />
                        <span
                          className="block h-full bg-[#cbd0db]"
                          style={{ width: `${pct(d.blockedHours)}%` }}
                        />
                      </span>
                      <span className="text-right text-gray-600 tabular-nums">
                        {fmtH(d.soldHours)} / {d.capacityHours} h
                      </span>
                    </li>
                  );
                })}
              </ul>
            </div>

            <footer className="mt-auto flex items-center justify-between border-gray-100 border-t pt-3">
              <span className="text-gray-400 text-xs">Prices excl. VAT</span>
              <button
                type="button"
                onClick={() => onEdit(r)}
                className="rounded-lg border border-gray-200 bg-white px-3 py-1.5 font-semibold text-[#000643] text-xs transition hover:border-[#000643]">
                Edit room
              </button>
            </footer>
          </article>
        );
      })}
    </div>
  );
}
