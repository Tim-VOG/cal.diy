"use client";

import { COUNTRY_OPTIONS } from "@calcom/features/ne26-rooms/lib/countries";
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

type Room = RoomAvailability["room"];
interface CostLine {
  slug: string;
  label: string;
  lineTotal: number;
}
interface BookingResult {
  uid: string;
  amountTotal: number;
  currency: string;
  holdExpiresAt: string | Date;
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

function addOnSuffix(priceType: AddOnPriceType, quantity: number): string {
  if (priceType === AddOnPriceType.PER_PERSON) return ` × ${quantity}`;
  if (priceType === AddOnPriceType.PER_HOUR) return ` × ${quantity}h`;
  return "";
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

function AddOnList({
  addOns,
  selected,
  onToggle,
  onSetQuantity,
}: {
  addOns: PublicAddOn[];
  selected: Record<string, number>;
  onToggle: (slug: string, checked: boolean) => void;
  onSetQuantity: (slug: string, quantity: number) => void;
}): JSX.Element | null {
  if (addOns.length === 0) return null;
  return (
    <>
      <h2 className="mt-6 font-semibold text-gray-500 text-sm uppercase tracking-wide">Add-ons</h2>
      <div className="mt-2 space-y-2">
        {addOns.map((addOn) => {
          const isSelected = addOn.slug in selected;
          const quantity = selected[addOn.slug] ?? 1;
          return (
            <div
              key={addOn.slug}
              className="flex items-center justify-between rounded-lg border border-gray-200 bg-white px-4 py-2.5 text-sm">
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={isSelected}
                  onChange={(e) => onToggle(addOn.slug, e.target.checked)}
                  className="h-4 w-4 accent-[#000643]"
                />
                <span>
                  <span className="font-medium">{addOn.name}</span>
                  <span className="ml-2 text-gray-400">{priceHint(addOn)}</span>
                </span>
              </label>
              {isSelected && addOn.priceType === AddOnPriceType.PER_PERSON ? (
                <div className="flex items-center gap-2">
                  <div className="flex items-center rounded-lg border border-gray-200">
                    <button
                      type="button"
                      onClick={() => onSetQuantity(addOn.slug, quantity - 1)}
                      disabled={quantity <= 1}
                      aria-label={`Fewer ${addOn.name}`}
                      className="px-2.5 py-1 text-[#000643] text-lg leading-none disabled:cursor-not-allowed disabled:text-gray-300">
                      −
                    </button>
                    <span className="w-8 text-center font-medium text-sm tabular-nums">{quantity}</span>
                    <button
                      type="button"
                      onClick={() => onSetQuantity(addOn.slug, quantity + 1)}
                      aria-label={`More ${addOn.name}`}
                      className="px-2.5 py-1 text-[#000643] text-lg leading-none">
                      +
                    </button>
                  </div>
                  <span className="text-gray-400 text-xs">people</span>
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
    </>
  );
}

function SelectionSummary({
  room,
  selectedDate,
  selectedStartUtc,
  selectedDuration,
  endIso,
  roomPrice,
  addOnLines,
  total,
  isAuthed,
  booking,
  errorMessage,
  isPending,
  canBook,
  onSubmit,
}: {
  room: Room;
  selectedDate: string;
  selectedStartUtc: string | null;
  selectedDuration: DurationHours | null;
  endIso: string | null;
  roomPrice: number | null;
  addOnLines: CostLine[];
  total: number | null;
  isAuthed: boolean;
  booking: BookingResult | undefined;
  errorMessage: string | null;
  isPending: boolean;
  canBook: boolean;
  onSubmit: () => void;
}): JSX.Element {
  return (
    <aside className="h-fit rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
      <h2 className="font-semibold text-gray-500 text-sm uppercase tracking-wide">Your selection</h2>

      {booking ? (
        <div className="mt-3 space-y-2 text-sm">
          <p className="font-semibold text-[#000643]">Slot held — redirecting to payment…</p>
          <p className="text-gray-600">Reference {booking.uid.slice(0, 8)}</p>
          <p className="font-bold text-[#000643] text-lg">{formatPrice(booking.amountTotal, booking.currency)}</p>
        </div>
      ) : (
        <>
          {selectedStartUtc && selectedDuration && endIso && roomPrice !== null ? (
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

              {/* Cost breakdown: room + each add-on, then total. */}
              <div className="mt-3 space-y-1 border-gray-100 border-t pt-3">
                <div className="flex justify-between">
                  <span className="text-gray-600">Room · {selectedDuration}h</span>
                  <span>{formatPrice(roomPrice, room.currency)}</span>
                </div>
                {addOnLines.map((line) => (
                  <div key={line.slug} className="flex justify-between">
                    <span className="text-gray-600">{line.label}</span>
                    <span>{formatPrice(line.lineTotal, room.currency)}</span>
                  </div>
                ))}
                <div className="mt-1 flex items-center justify-between border-gray-100 border-t pt-2 font-bold text-[#000643]">
                  <span className="flex items-center gap-1">
                    <Euro className="h-4 w-4 shrink-0" aria-hidden />
                    Total
                  </span>
                  <span>{total !== null ? formatPrice(total, room.currency) : ""}</span>
                </div>
              </div>
            </div>
          ) : (
            <p className="mt-3 text-gray-500 text-sm">Pick a start time and duration to see the price.</p>
          )}

          {errorMessage ? (
            <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-red-700 text-sm">{errorMessage}</p>
          ) : null}

          {isAuthed ? (
            <button
              type="button"
              disabled={!canBook}
              onClick={onSubmit}
              className="mt-5 w-full rounded-lg bg-[#000643] px-4 py-2.5 font-semibold text-sm text-white transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40">
              {isPending ? "Holding…" : "Continue to payment"}
            </button>
          ) : (
            <a
              href={`/auth/login?callbackUrl=/rooms/${room.slug}`}
              className="mt-5 block w-full rounded-lg bg-[#000643] px-4 py-2.5 text-center font-semibold text-sm text-white transition hover:opacity-90">
              Log in to book
            </a>
          )}
          <p className="mt-2 text-center text-gray-400 text-xs">Secure payment via Stripe.</p>
        </>
      )}
    </aside>
  );
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
  const [country, setCountry] = useState("");
  const [vatNumber, setVatNumber] = useState("");

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

  const addOnLines: CostLine[] = [];
  if (selectedDuration != null) {
    for (const [slug, quantity] of Object.entries(selectedAddOns)) {
      const addOn = addOnsBySlug.get(slug);
      if (!addOn) continue;
      const line = computeAddOnLine(addOn.priceType, addOn.price, quantity, selectedDuration);
      addOnLines.push({ slug, label: `${addOn.name}${addOnSuffix(addOn.priceType, line.quantity)}`, lineTotal: line.lineTotal });
    }
  }
  const addOnTotal = addOnLines.reduce((sum, line) => sum + line.lineTotal, 0);
  const total = selectedDuration ? priceForDuration[selectedDuration] + addOnTotal : null;
  const canBook = Boolean(selectedStartUtc && selectedDuration && country) && !createBooking.isPending;

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

  function setQuantity(slug: string, quantity: number): void {
    setSelectedAddOns((prev) => ({ ...prev, [slug]: Math.max(1, quantity) }));
  }

  function submit(): void {
    if (!selectedStartUtc || !selectedDuration || !country) return;
    createBooking.mutate(
      {
        slug: room.slug,
        startUtc: selectedStartUtc,
        durationHours: selectedDuration,
        country,
        vatNumber: vatNumber.trim() || undefined,
        addOns: Object.entries(selectedAddOns).map(([slug, quantity]) => ({ slug, quantity })),
      },
      {
        onSuccess: (data) => {
          if (data.checkoutUrl) window.location.href = data.checkoutUrl;
        },
      }
    );
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

        <AddOnList addOns={addOns} selected={selectedAddOns} onToggle={toggleAddOn} onSetQuantity={setQuantity} />

        {/* Billing details — drive the invoice VAT treatment */}
        <h2 className="mt-6 font-semibold text-gray-500 text-sm uppercase tracking-wide">Billing</h2>
        <div className="mt-2 grid grid-cols-1 gap-3 sm:grid-cols-2">
          <label>
            <span className="text-gray-600 text-sm">Country *</span>
            <select
              value={country}
              onChange={(e) => setCountry(e.target.value)}
              className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-[#000643] focus:outline-none">
              <option value="">Select your country…</option>
              {COUNTRY_OPTIONS.map((c) => (
                <option key={c.code} value={c.code}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span className="text-gray-600 text-sm">VAT number (optional)</span>
            <input
              type="text"
              value={vatNumber}
              onChange={(e) => setVatNumber(e.target.value)}
              placeholder="e.g. BE0123456789"
              className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-[#000643] focus:outline-none"
            />
          </label>
        </div>
      </div>

      <SelectionSummary
        room={room}
        selectedDate={selectedDate}
        selectedStartUtc={selectedStartUtc}
        selectedDuration={selectedDuration}
        endIso={endIso}
        roomPrice={selectedDuration ? priceForDuration[selectedDuration] : null}
        addOnLines={addOnLines}
        total={total}
        isAuthed={isAuthed}
        booking={createBooking.data}
        errorMessage={createBooking.error?.message ?? null}
        isPending={createBooking.isPending}
        canBook={canBook}
        onSubmit={submit}
      />
    </div>
  );
}
