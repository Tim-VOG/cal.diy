"use client";

import type { DurationHours } from "@calcom/features/ne26-rooms/lib/eventSchedule";
import {
  EXTENDED_USE_DISCOUNT_NOTE,
  extendedUseDiscountPct,
} from "@calcom/features/ne26-rooms/lib/discount";
import { computeAddOnLine } from "@calcom/features/ne26-rooms/lib/pricing";
import { buildRoomPhotoList } from "@calcom/features/ne26-rooms/lib/roomImages";
import type { RoomAvailability } from "@calcom/features/ne26-rooms/services/RoomAvailabilityService";
import type { VatPreview } from "@calcom/features/ne26-rooms/services/RoomVatPreviewService";
import { AddOnPriceType } from "@calcom/prisma/enums";
import { trpc } from "@calcom/trpc/react";
import { Building, Clock, Euro, Info, Scaling, Users } from "lucide-react";
import { useMemo, useState } from "react";
import { servicesFor } from "../amenities";
import RoomGallery from "./RoomGallery";

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
  const [infoSlug, setInfoSlug] = useState<string | null>(null);
  if (addOns.length === 0) return null;
  return (
    <>
      <h2 className="mt-6 font-semibold text-gray-500 text-sm uppercase tracking-wide">Add-ons</h2>
      {/* w-fit: every row shrinks to fit, all matching the widest add-on. */}
      <div className="mt-2 flex w-fit max-w-full flex-col gap-2">
        {addOns.map((addOn) => {
          const isSelected = addOn.slug in selected;
          const quantity = selected[addOn.slug] ?? 1;
          const infoOpen = infoSlug === addOn.slug;
          return (
            <div
              key={addOn.slug}
              className="w-full rounded-lg border border-gray-200 bg-white px-4 py-2.5 text-sm">
              <div className="flex items-center justify-between gap-2">
                <div className="flex min-w-0 items-center gap-2">
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
                  {addOn.description ? (
                    <button
                      type="button"
                      aria-label={`About ${addOn.name}`}
                      aria-expanded={infoOpen}
                      onClick={() => setInfoSlug((s) => (s === addOn.slug ? null : addOn.slug))}
                      className={`shrink-0 transition ${infoOpen ? "text-[#000643]" : "text-gray-400 hover:text-[#000643]"}`}>
                      <Info className="h-4 w-4" aria-hidden />
                    </button>
                  ) : null}
                </div>
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
              {addOn.description && infoOpen ? (
                <p className="mt-2 max-w-xs border-gray-100 border-t pt-2 text-gray-600 text-xs leading-relaxed">
                  {addOn.description}
                </p>
              ) : null}
            </div>
          );
        })}
      </div>
    </>
  );
}

function vatPct(bp: number): string {
  return `${bp / 100}%`;
}

// VAT recap derived from the buyer's saved billing profile: prices are HT, so
// this adds the VAT and shows the incl.-VAT total actually charged. Without a
// saved country we can't resolve VAT here, so we point to the billing details.
function VatRecap({ vat }: { vat: VatPreview }): JSX.Element {
  if (!vat.hasBuyerCountry) {
    return (
      <p className="mt-2 text-gray-400 text-xs">
        VAT is added at payment.{" "}
        <a href="/rooms/account" className="underline hover:text-[#000643]">
          Add your billing details
        </a>{" "}
        to preview it.
      </p>
    );
  }
  return (
    <div className="mt-2 space-y-0.5 text-gray-500 text-xs">
      {vat.zeroRated ? (
        <>
          <div className="flex justify-between">
            <span>VAT (0%)</span>
            <span>{formatPrice(0, vat.currency)}</span>
          </div>
          {vat.mention ? <p className="text-gray-400">{vat.mention}</p> : null}
        </>
      ) : (
        vat.vatBreakdown.map((v) => (
          <div key={v.vatRate} className="flex justify-between">
            <span>VAT {vatPct(v.vatRate)}</span>
            <span>{formatPrice(v.vat, vat.currency)}</span>
          </div>
        ))
      )}
      <div className="flex justify-between border-gray-100 border-t pt-1 font-bold text-[#000643]">
        <span>Total incl. VAT</span>
        <span>{formatPrice(vat.totalTtc, vat.currency)}</span>
      </div>
    </div>
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
  vat,
  isAuthed,
  billingComplete,
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
  vat: VatPreview | undefined;
  isAuthed: boolean;
  billingComplete: boolean;
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
          <p className="font-bold text-[#000643] text-lg">
            {formatPrice(booking.amountTotal, booking.currency)}
          </p>
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
                <div className="mt-1 flex items-center justify-between border-gray-100 border-t pt-2 font-medium text-gray-700">
                  <span className="flex items-center gap-1">
                    <Euro className="h-4 w-4 shrink-0" aria-hidden />
                    Total excl. VAT
                  </span>
                  <span>{total !== null ? formatPrice(total, room.currency) : ""}</span>
                </div>
                {isAuthed && vat ? <VatRecap vat={vat} /> : null}
              </div>
            </div>
          ) : (
            <p className="mt-3 text-gray-500 text-sm">Pick a start time and duration to see the price.</p>
          )}

          {errorMessage ? (
            <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-red-700 text-sm">{errorMessage}</p>
          ) : null}

          {!isAuthed ? (
            <a
              href={`/rooms/login?callbackUrl=/rooms/${room.slug}`}
              className="mt-5 block w-full rounded-lg bg-[#000643] px-4 py-2.5 text-center font-semibold text-sm text-white transition hover:opacity-90">
              Log in to book
            </a>
          ) : !billingComplete ? (
            <>
              <p className="mt-4 rounded-lg bg-amber-50 px-3 py-2 text-amber-800 text-sm">
                Add your billing details first — they appear on your invoice.
              </p>
              <a
                href="/rooms/account"
                className="mt-3 block w-full rounded-lg bg-[#000643] px-4 py-2.5 text-center font-semibold text-sm text-white transition hover:opacity-90">
                Complete billing details
              </a>
            </>
          ) : (
            <button
              type="button"
              disabled={!canBook}
              onClick={onSubmit}
              className="mt-5 w-full rounded-lg bg-[#000643] px-4 py-2.5 font-semibold text-sm text-white transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40">
              {isPending ? "Holding…" : "Continue to payment"}
            </button>
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
  billingComplete,
}: {
  availability: RoomAvailability;
  addOns: PublicAddOn[];
  isAuthed: boolean;
  billingComplete: boolean;
}): JSX.Element {
  const { room, days } = availability;
  const priceForDuration: Record<DurationHours, number> = {
    1: room.price1h,
    2: room.price2h,
    3: room.price3h,
  };
  const addOnsBySlug = useMemo(() => new Map(addOns.map((a) => [a.slug, a])), [addOns]);
  const photos = useMemo(() => buildRoomPhotoList(room.imageUrl, room.galleryImages), [room]);

  const [selectedDate, setSelectedDate] = useState(days[0]?.date ?? "");
  const [selectedStartUtc, setSelectedStartUtc] = useState<string | null>(null);
  // Duration is chosen first; start slots that can't fit it are then disabled.
  const [selectedDuration, setSelectedDuration] = useState<DurationHours>(1);
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

  const addOnLines: CostLine[] = [];
  if (selectedDuration != null) {
    for (const [slug, quantity] of Object.entries(selectedAddOns)) {
      const addOn = addOnsBySlug.get(slug);
      if (!addOn) continue;
      const line = computeAddOnLine(addOn.priceType, addOn.price, quantity, selectedDuration);
      addOnLines.push({
        slug,
        label: `${addOn.name}${addOnSuffix(addOn.priceType, line.quantity)}`,
        lineTotal: line.lineTotal,
      });
    }
  }
  const addOnTotal = addOnLines.reduce((sum, line) => sum + line.lineTotal, 0);
  const total = selectedDuration ? priceForDuration[selectedDuration] + addOnTotal : null;
  const canBook = Boolean(selectedStartUtc && selectedDuration) && !createBooking.isPending;

  const addOnsPayload = useMemo(
    () => Object.entries(selectedAddOns).map(([slug, quantity]) => ({ slug, quantity })),
    [selectedAddOns]
  );
  const vatPreview = trpc.viewer.rooms.previewVat.useQuery(
    { slug: room.slug, durationHours: (selectedDuration ?? 1) as DurationHours, addOns: addOnsPayload },
    { enabled: isAuthed && Boolean(selectedStartUtc) && selectedDuration != null }
  );

  function pickStart(startUtc: string): void {
    setSelectedStartUtc(startUtc);
    createBooking.reset();
  }

  // Available start slots adapt to the chosen duration (not the reverse): if the
  // current start can't fit the new duration, clear it so the booker re-picks.
  function chooseDuration(d: DurationHours): void {
    setSelectedDuration(d);
    if (selectedStart && !selectedStart.availableDurations.includes(d)) setSelectedStartUtc(null);
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
    if (!selectedStartUtc || !selectedDuration) return;
    createBooking.mutate(
      {
        slug: room.slug,
        startUtc: selectedStartUtc,
        durationHours: selectedDuration,
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

        {/* Included in the price. Suites carry an extra line — that difference is
            what justifies their premium over a same-capacity meeting room, so it
            has to be visible where the buyer compares them. */}
        <div className="mt-4 rounded-xl border border-gray-200 bg-white p-4">
          <h2 className="font-semibold text-gray-500 text-xs uppercase tracking-wide">
            Included in the price
          </h2>
          <ul className="mt-2 space-y-1.5">
            {servicesFor(room.category).map(({ icon: ServiceIcon, label, detail }) => (
              <li key={label} className="flex items-start gap-2 text-sm">
                <ServiceIcon className="mt-0.5 h-4 w-4 shrink-0 text-[#000643]" aria-hidden />
                <span>
                  <span className="font-medium">{label}</span>
                  {detail ? <span className="text-gray-500"> — {detail}</span> : null}
                </span>
              </li>
            ))}
          </ul>
        </div>

        <RoomGallery photos={photos} roomName={room.name} />

        {/* Day selector */}
        <div className="mt-6 flex gap-2">
          {days.map((d) => (
            <button
              key={d.date}
              type="button"
              onClick={() => {
                setSelectedDate(d.date);
                setSelectedStartUtc(null);
                createBooking.reset();
              }}
              className={`${CELL_BASE} ${CELL_CLASS[cellState(d.date === selectedDate, true)]}`}>
              {formatDayLabel(d.date)}
            </button>
          ))}
        </div>

        {/* Duration first — start slots below adapt to it */}
        <h2 className="mt-6 font-semibold text-gray-500 text-sm uppercase tracking-wide">Duration</h2>
        {/* flex-wrap: three "3h — 1 836 € -15%" buttons overflow a 375px screen. */}
        <div className="mt-2 flex flex-wrap gap-2">
          {DURATIONS.map((d) => {
            // Derived from the room's own prices, so the badge always matches
            // what is charged — change a tariff in the admin and this follows.
            const discount = extendedUseDiscountPct(room.price1h, priceForDuration[d], d);
            const isSelected = d === selectedDuration;
            return (
              <button
                key={d}
                type="button"
                aria-pressed={isSelected}
                onClick={() => chooseDuration(d)}
                className={`${CELL_BASE} ${CELL_CLASS[cellState(isSelected, true)]}`}>
                {d}h — {formatPrice(priceForDuration[d], room.currency)}
                {discount ? (
                  <span
                    className={`ml-1.5 font-semibold ${isSelected ? "text-white/90" : "text-green-700"}`}>
                    −{discount}%
                  </span>
                ) : null}
              </button>
            );
          })}
        </div>
        {/* The last sentence matters commercially: two separate 1h bookings do
            not earn the 2h price, and buyers do ask. */}
        <p className="mt-2 max-w-prose text-gray-500 text-xs leading-relaxed">
          {EXTENDED_USE_DISCOUNT_NOTE}
        </p>

        {/* Start times — only those that can fit the chosen duration are enabled */}
        <h2 className="mt-6 flex items-center gap-1.5 font-semibold text-gray-500 text-sm uppercase tracking-wide">
          <Clock className="h-4 w-4 shrink-0" aria-hidden />
          Start time
          <span className="font-normal normal-case text-gray-400">({selectedDuration}h)</span>
        </h2>
        <div className="mt-2 grid grid-cols-3 gap-2 sm:grid-cols-4">
          {day?.starts.map((s) => {
            const fitsDuration = s.availableDurations.includes(selectedDuration);
            const state = cellState(s.startUtc === selectedStartUtc, fitsDuration);
            return (
              <button
                key={s.startUtc}
                type="button"
                disabled={!fitsDuration}
                onClick={() => pickStart(s.startUtc)}
                className={`${CELL_BASE} ${CELL_CLASS[state]} ${state === "disabled" ? "line-through" : ""}`}>
                {formatTime(s.startUtc)}
              </button>
            );
          })}
        </div>

        <AddOnList
          addOns={addOns}
          selected={selectedAddOns}
          onToggle={toggleAddOn}
          onSetQuantity={setQuantity}
        />
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
        vat={vatPreview.data}
        isAuthed={isAuthed}
        billingComplete={billingComplete}
        booking={createBooking.data}
        errorMessage={createBooking.error?.message ?? null}
        isPending={createBooking.isPending}
        canBook={canBook}
        onSubmit={submit}
      />
    </div>
  );
}
