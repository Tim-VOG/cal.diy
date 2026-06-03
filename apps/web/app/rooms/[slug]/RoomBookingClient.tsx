"use client";

import type { DurationHours } from "@calcom/features/ne26-rooms/lib/eventSchedule";
import { computeAddOnLine } from "@calcom/features/ne26-rooms/lib/pricing";
import type { RoomAvailability } from "@calcom/features/ne26-rooms/services/RoomAvailabilityService";
import { AddOnPriceType } from "@calcom/prisma/enums";
import { trpc } from "@calcom/trpc/react";
import { Building, Clock, Euro, Scaling, Users } from "lucide-react";
import { useMemo, useState } from "react";

import { AMENITIES } from "../amenities";

const TZ = "Europe/Brussels";
const MS_PER_HOUR = 60 * 60 * 1000;
const DURATIONS: DurationHours[] = [1, 2, 3];

export interface PublicAddOn {
  id: number;
  name: string;
  slug: string;
  description: string | null;
  price: number;
  currency: string;
  priceType: AddOnPriceType;
  vatRate: number;
}

function formatTime(iso: string): string {
  return new Intl.DateTimeFormat("en-GB", { timeZone: TZ, hour: "2-digit", minute: "2-digit", hour12: false }).format(
    new Date(iso)
  );
}

function formatDayLabel(date: string): string {
  return new Intl.DateTimeFormat("en-GB", { timeZone: TZ, weekday: "short", day: "numeric", month: "short" }).format(
    new Date(`${date}T12:00:00.000Z`)
  );
}

function formatPrice(cents: number, currency: string): string {
  return new Intl.NumberFormat("en-GB", { style: "currency", currency }).format(cents / 100);
}

function priceHint(addOn: PublicAddOn): string {
  const price = formatPrice(addOn.price, addOn.currency);
  if (addOn.priceType === AddOnPriceType.PER_PERSON) return `${price} / person`;
  if (addOn.priceType === AddOnPriceType.PER_HOUR) return `${price} / hour`;
  return price;
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

export default function RoomBookingClient({
  availability,
  addOns,
  isAuthed,
}: {
  availability: RoomAvailability;
  addOns: PublicAddOn[];
  isAuthed: boolean;
}): JSX.Element {
  const { room, days } = availability;
  const priceForDuration: Record<DurationHours, number> = { 1: room.price1h, 2: room.price2h, 3: room.price3h };
  const addOnsBySlug = useMemo(() => new Map(addOns.map((a) => [a.slug, a])), [addOns]);

  const [selectedDate, setSelectedDate] = useState(days[0]?.date ?? "");
  const [selectedStartUtc, setSelectedStartUtc] = useState<string | null>(null);
  const [selectedDuration, setSelectedDuration] = useState<DurationHours | null>(null);
  const [selectedAddOns, setSelectedAddOns] = useState<Record<string, number>>({});

  const createBooking = trpc.viewer.rooms.createBooking.useMutation();

  const day = useMemo(() => days.find((d) => d.date === selectedDate), [days, selectedDate]);
  const selectedStart = useMemo(
    () => day?.starts.find((s) => s.startUtc === selectedStartUtc) ?? null,
    [day, selectedStartUtc]
  );

  const endIso =
    selectedStartUtc && selectedDuration
      ? new Date(new Date(selectedStartUtc).getTime() + selectedDuration * MS_PER_HOUR).toISOString()
      : null;

  const addOnTotal = selectedDuration
    ? Object.entries(selectedAddOns).reduce((sum, [slug, quantity]) => {
        const addOn = addOnsBySlug.get(slug);
        if (!addOn) return sum;
        return sum + computeAddOnLine(addOn.priceType, addOn.price, quantity, selectedDuration).lineTotal;
      }, 0)
    : 0;
  const total = selectedDuration ? priceForDuration[selectedDuration] + addOnTotal : null;
  const canBook = Boolean(selectedStartUtc && selectedDuration) && !createBooking.isPending;
  const booking = createBooking.data;

  function pickStart(startUtc: string, availableDurations: DurationHours[]): void {
    setSelectedStartUtc(startUtc);
    setSelectedDuration(availableDurations[0] ?? null);
    createBooking.reset();
  }

  function toggleAddOn(slug: string, checked: boolean): void {
    setSelectedAddOns((prev) => {
      const next = { ...prev };
      if (checked) next[slug] = 1;
      else delete next[slug];
      return next;
    });
  }

  function submit(): void {
    if (!selectedStartUtc || !selectedDuration) return;
    createBooking.mutate({
      slug: room.slug,
      startUtc: selectedStartUtc,
      durationHours: selectedDuration,
      addOns: Object.entries(selectedAddOns).map(([slug, quantity]) => ({ slug, quantity })),
    });
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
        <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-gray-600 text-sm">
          <span className="flex items-center gap-1.5">
            <Users className="h-4 w-4 shrink-0" aria-hidden />
            Up to {room.capacity} people
          </span>
          <span className="flex items-center gap-1.5">
            <Scaling className="h-4 w-4 shrink-0" aria-hidden />
            {room.surface} m²
          </span>
        </div>

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
                createBooking.reset();
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

        {/* Add-ons */}
        {addOns.length > 0 ? (
          <>
            <h2 className="mt-6 font-semibold text-gray-500 text-sm uppercase tracking-wide">Add-ons</h2>
            <div className="mt-2 space-y-2">
              {addOns.map((addOn) => {
                const selected = addOn.slug in selectedAddOns;
                return (
                  <div
                    key={addOn.slug}
                    className="flex items-center justify-between rounded-lg border border-gray-200 bg-white px-4 py-2.5 text-sm">
                    <label className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={selected}
                        onChange={(e) => toggleAddOn(addOn.slug, e.target.checked)}
                        className="h-4 w-4 accent-[#000643]"
                      />
                      <span>
                        <span className="font-medium">{addOn.name}</span>
                        <span className="ml-2 text-gray-400">{priceHint(addOn)}</span>
                      </span>
                    </label>
                    {selected && addOn.priceType === AddOnPriceType.PER_PERSON ? (
                      <input
                        type="number"
                        min={1}
                        value={selectedAddOns[addOn.slug]}
                        onChange={(e) =>
                          setSelectedAddOns((prev) => ({ ...prev, [addOn.slug]: Math.max(1, Number(e.target.value)) }))
                        }
                        aria-label={`${addOn.name} quantity`}
                        className="w-16 rounded border border-gray-200 px-2 py-1 text-right"
                      />
                    ) : null}
                  </div>
                );
              })}
            </div>
          </>
        ) : null}
      </div>

      {/* Summary panel */}
      <aside className="h-fit rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
        <h2 className="font-semibold text-gray-500 text-sm uppercase tracking-wide">Your selection</h2>

        {booking ? (
          <div className="mt-3 space-y-2 text-sm">
            <p className="font-semibold text-[#000643]">Slot held ✓</p>
            <p className="text-gray-600">Reference {booking.uid.slice(0, 8)}</p>
            <p className="font-bold text-[#000643] text-lg">{formatPrice(booking.amountTotal, booking.currency)}</p>
            <p className="text-gray-500 text-xs">
              Held until {formatTime(new Date(booking.holdExpiresAt).toISOString())}. Payment is the next step.
            </p>
          </div>
        ) : (
          <>
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

            {createBooking.error ? (
              <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-red-700 text-sm">{createBooking.error.message}</p>
            ) : null}

            {isAuthed ? (
              <button
                type="button"
                disabled={!canBook}
                onClick={submit}
                className="mt-5 w-full rounded-lg bg-[#000643] px-4 py-2.5 font-semibold text-sm text-white transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40">
                {createBooking.isPending ? "Holding…" : "Continue"}
              </button>
            ) : (
              <a
                href={`/auth/login?callbackUrl=/rooms/${room.slug}`}
                className="mt-5 block w-full rounded-lg bg-[#000643] px-4 py-2.5 text-center font-semibold text-sm text-white transition hover:opacity-90">
                Log in to book
              </a>
            )}
            <p className="mt-2 text-center text-gray-400 text-xs">Payment comes in the next step.</p>
          </>
        )}
      </aside>
    </div>
  );
}
