"use client";

import type { DurationHours } from "@calcom/features/ne26-rooms/lib/eventSchedule";
import type { RoomAvailability } from "@calcom/features/ne26-rooms/services/RoomAvailabilityService";
import { Building, Clock, Euro, Users } from "lucide-react";
import { useMemo, useState } from "react";

import { AMENITIES } from "../amenities";

const TZ = "Europe/Brussels";
const MS_PER_HOUR = 60 * 60 * 1000;
const DURATIONS: DurationHours[] = [1, 2, 3];

function formatTime(iso: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: TZ,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(iso));
}

function formatDayLabel(date: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: TZ,
    weekday: "short",
    day: "numeric",
    month: "short",
  }).format(new Date(`${date}T12:00:00.000Z`));
}

function formatPrice(cents: number, currency: string): string {
  return new Intl.NumberFormat("en-GB", { style: "currency", currency }).format(cents / 100);
}

type CellState = "selected" | "available" | "disabled";

const CELL_BASE = "rounded-lg border px-4 py-2 text-sm font-medium transition";
const CELL_CLASS: Record<CellState, string> = {
  selected: "border-[#000643] bg-[#000643] text-white",
  available: "border-gray-200 bg-white text-black hover:border-[#000643]",
  disabled: "cursor-not-allowed border-gray-100 bg-gray-100 text-gray-300",
};

function cellState(isSelected: boolean, isEnabled: boolean): CellState {
  if (isSelected) return "selected";
  if (isEnabled) return "available";
  return "disabled";
}

export default function RoomBookingClient({ availability }: { availability: RoomAvailability }): JSX.Element {
  const { room, days } = availability;
  const priceForDuration: Record<DurationHours, number> = {
    1: room.price1h,
    2: room.price2h,
    3: room.price3h,
  };

  const [selectedDate, setSelectedDate] = useState(days[0]?.date ?? "");
  const [selectedStartUtc, setSelectedStartUtc] = useState<string | null>(null);
  const [selectedDuration, setSelectedDuration] = useState<DurationHours | null>(null);

  const day = useMemo(() => days.find((d) => d.date === selectedDate), [days, selectedDate]);
  const selectedStart = useMemo(
    () => day?.starts.find((s) => s.startUtc === selectedStartUtc) ?? null,
    [day, selectedStartUtc]
  );

  const endIso =
    selectedStartUtc && selectedDuration
      ? new Date(new Date(selectedStartUtc).getTime() + selectedDuration * MS_PER_HOUR).toISOString()
      : null;
  const total = selectedDuration ? priceForDuration[selectedDuration] : null;

  function pickStart(startUtc: string, availableDurations: DurationHours[]): void {
    setSelectedStartUtc(startUtc);
    setSelectedDuration(availableDurations[0] ?? null);
  }

  return (
    <div className="grid grid-cols-1 gap-8 lg:grid-cols-[1fr_320px]">
      <div>
        <a href="/rooms" className="text-gray-500 text-sm hover:text-[#000643]">
          ← All rooms
        </a>
        <h1 className="mt-2 flex items-center gap-2 font-bold text-2xl text-[#000643]">
          <Building className="h-6 w-6 shrink-0" aria-hidden />
          {room.name}
        </h1>
        <p className="mt-2 flex items-center gap-1.5 text-gray-600 text-sm">
          <Users className="h-4 w-4 shrink-0" aria-hidden />
          Up to {room.capacity} people
        </p>

        {/* Amenities */}
        <div className="mt-4 flex flex-wrap gap-x-5 gap-y-2">
          {AMENITIES.map(({ icon: AmenityIcon, label }) => (
            <span key={label} className="flex items-center gap-1.5 text-gray-600 text-sm">
              <AmenityIcon className="h-4 w-4 shrink-0 text-[#000643]" aria-hidden />
              {label}
            </span>
          ))}
        </div>

        {/* Day selector */}
        <div className="mt-6 flex gap-2">
          {days.map((d) => (
            <button
              key={d.date}
              type="button"
              onClick={() => {
                setSelectedDate(d.date);
                setSelectedStartUtc(null);
                setSelectedDuration(null);
              }}
              className={`${CELL_BASE} ${CELL_CLASS[cellState(d.date === selectedDate, true)]}`}>
              {formatDayLabel(d.date)}
            </button>
          ))}
        </div>

        {/* Start times */}
        <h2 className="mt-6 flex items-center gap-1.5 font-semibold text-gray-500 text-sm uppercase tracking-wide">
          <Clock className="h-4 w-4 shrink-0" aria-hidden />
          Start time
        </h2>
        <div className="mt-2 grid grid-cols-3 gap-2 sm:grid-cols-4">
          {day?.starts.map((s) => {
            const isAvailable = s.availableDurations.length > 0;
            const state = cellState(s.startUtc === selectedStartUtc, isAvailable);
            return (
              <button
                key={s.startUtc}
                type="button"
                disabled={!isAvailable}
                onClick={() => pickStart(s.startUtc, s.availableDurations)}
                className={`${CELL_BASE} ${CELL_CLASS[state]} ${state === "disabled" ? "line-through" : ""}`}>
                {formatTime(s.startUtc)}
              </button>
            );
          })}
        </div>

        {/* Duration */}
        {selectedStart ? (
          <>
            <h2 className="mt-6 font-semibold text-gray-500 text-sm uppercase tracking-wide">Duration</h2>
            <div className="mt-2 flex gap-2">
              {DURATIONS.map((d) => {
                const enabled = selectedStart.availableDurations.includes(d);
                return (
                  <button
                    key={d}
                    type="button"
                    disabled={!enabled}
                    onClick={() => setSelectedDuration(d)}
                    className={`${CELL_BASE} ${CELL_CLASS[cellState(d === selectedDuration, enabled)]}`}>
                    {d}h — {formatPrice(priceForDuration[d], room.currency)}
                  </button>
                );
              })}
            </div>
          </>
        ) : null}
      </div>

      {/* Summary panel */}
      <aside className="h-fit rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
        <h2 className="font-semibold text-gray-500 text-sm uppercase tracking-wide">Your selection</h2>
        {selectedStartUtc && selectedDuration && endIso ? (
          <div className="mt-3 space-y-1 text-sm">
            <p className="flex items-center gap-1.5 font-medium">
              <Building className="h-4 w-4 shrink-0 text-[#000643]" aria-hidden />
              {room.name}
            </p>
            <p>{formatDayLabel(selectedDate)}</p>
            <p className="flex items-center gap-1.5">
              <Clock className="h-4 w-4 shrink-0 text-gray-400" aria-hidden />
              {formatTime(selectedStartUtc)} – {formatTime(endIso)} ({selectedDuration}h)
            </p>
            <p className="mt-3 flex items-center gap-1 font-bold text-[#000643] text-lg">
              <Euro className="h-5 w-5 shrink-0" aria-hidden />
              {total !== null ? formatPrice(total, room.currency) : ""}
            </p>
          </div>
        ) : (
          <p className="mt-3 text-gray-500 text-sm">Pick a start time and duration to see the price.</p>
        )}

        <button
          type="button"
          disabled={!selectedStartUtc || !selectedDuration}
          className="mt-5 w-full rounded-lg bg-[#000643] px-4 py-2.5 font-semibold text-sm text-white transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
          title="Add-ons, login and payment arrive in the next step">
          Continue
        </button>
        <p className="mt-2 text-center text-gray-400 text-xs">Add-ons & payment come in the next step.</p>
      </aside>
    </div>
  );
}
