"use client";

import { EXTENDED_USE_DISCOUNT_NOTE, extendedUseDiscountPct } from "@calcom/features/ne26-rooms/lib/discount";
import type { DurationHours } from "@calcom/features/ne26-rooms/lib/eventSchedule";
import { computeAddOnLine } from "@calcom/features/ne26-rooms/lib/pricing";
import { buildRoomPhotoList } from "@calcom/features/ne26-rooms/lib/roomImages";
import type { RoomAvailability } from "@calcom/features/ne26-rooms/services/RoomAvailabilityService";
import { AddOnPriceType } from "@calcom/prisma/enums";
import { trpc } from "@calcom/trpc/react";
import { Clock, Euro, Scaling, Users } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { servicesFor } from "../amenities";
import { clearSelection, getSelection, saveSelection } from "../selectionStore";
import RoomGallery from "./RoomGallery";
import { eventMinuteOfDay } from "@calcom/features/ne26-rooms/lib/deskDay";
import { minimumCoversFor } from "@calcom/features/ne26-rooms/lib/pricing";
import { roomIconFor } from "../roomIcon";
import { EVENT_TIME_ZONE } from "@calcom/features/ne26-rooms/lib/eventSchedule";
import {
  formatAddOnWindow,
  isAddOnOfferedDuring,
  type SlotWindow,
} from "@calcom/features/ne26-rooms/lib/pricing";

const TZ = EVENT_TIME_ZONE;
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
  /** Minutes from event-local midnight; null means available all day. */
  availableFromMinute: number | null;
  availableToMinute: number | null;
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
  /** Null once the order is paid; the client only ever reads it while held. */
  holdExpiresAt: string | Date | null;
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

/**
 * An add-on's description, with the little formatting the admin needs.
 *
 * The caterer's copy is a sentence followed by a list of what is in the box.
 * Lines beginning with "-" become bullets and everything else stays a
 * paragraph — enough structure to be readable, without a rich-text editor or
 * any HTML from the admin reaching the page.
 */
function AddOnDescription({ text }: { text: string }): JSX.Element {
  const blocks: { kind: "p" | "ul"; lines: string[] }[] = [];
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    const bullet = line.startsWith("-") || line.startsWith("•");
    const content = bullet ? line.replace(/^[-•]\s*/, "") : line;
    const last = blocks.at(-1);
    if (last && ((bullet && last.kind === "ul") || (!bullet && last.kind === "p"))) {
      last.lines.push(content);
    } else {
      blocks.push({ kind: bullet ? "ul" : "p", lines: [content] });
    }
  }
  return (
    <>
      {blocks.map((block, i) =>
        block.kind === "ul" ? (
          // biome-ignore lint/suspicious/noArrayIndexKey: blocks are positional
          <ul key={i} className="mt-1 list-disc space-y-0.5 pl-4">
            {block.lines.map((l) => (
              <li key={l}>{l}</li>
            ))}
          </ul>
        ) : (
          // biome-ignore lint/suspicious/noArrayIndexKey: blocks are positional
          <p key={i} className={i === 0 ? "" : "mt-1.5"}>
            {block.lines.join(" ")}
          </p>
        )
      )}
    </>
  );
}

function AddOnList({
  addOns,
  selected,
  roomCapacity,
  roomCategory,
  slot,
  onToggle,
  onSetQuantity,
}: {
  addOns: PublicAddOn[];
  selected: Record<string, number>;
  /** Per-person add-ons cannot exceed the seats in the room. */
  roomCapacity: number;
  /** Decides the per-person minimum: a suite starts higher than a small room. */
  roomCategory: string;
  /** The chosen slot, so an add-on served only at certain hours can say so. */
  slot: SlotWindow | null;
  onToggle: (slug: string, checked: boolean) => void;
  onSetQuantity: (slug: string, quantity: number) => void;
}): JSX.Element | null {
  if (addOns.length === 0) return null;
  return (
    <>
      <h2 className="mt-6 font-semibold text-gray-500 text-sm uppercase tracking-wide">Add-ons</h2>
      {/* w-fit: every row shrinks to fit, all matching the widest add-on. */}
      <div className="mt-2 flex w-fit max-w-full flex-col gap-2">
        {addOns.map((addOn) => {
          const isSelected = addOn.slug in selected;
          const quantity = selected[addOn.slug] ?? 1;
          // Shown greyed rather than hidden: an exhibitor looking for lunch
          // needs to learn it is served 11:00-14:00, not find it silently gone.
          const offered = !slot || isAddOnOfferedDuring(addOn, slot);
          const perPerson = addOn.priceType === AddOnPriceType.PER_PERSON;
          const minimumCovers = perPerson ? minimumCoversFor(roomCategory) : 1;
          const window =
            addOn.availableFromMinute != null && addOn.availableToMinute != null
              ? formatAddOnWindow(addOn.availableFromMinute, addOn.availableToMinute)
              : null;
          return (
            <div
              key={addOn.slug}
              className={`w-full rounded-lg border border-gray-200 bg-white px-4 py-2.5 text-sm ${
                offered ? "" : "opacity-60"
              }`}>
              <div className="flex items-center justify-between gap-2">
                <div className="flex min-w-0 items-center gap-2">
                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={isSelected}
                      disabled={!offered}
                      onChange={(e) => onToggle(addOn.slug, e.target.checked)}
                      className="h-4 w-4 accent-[#000643] disabled:cursor-not-allowed"
                    />
                    <span>
                      <span className="font-medium">{addOn.name}</span>
                      <span className="ml-2 text-gray-400">{priceHint(addOn)}</span>
                      {!offered && window ? (
                        <span className="ml-2 text-amber-700 text-xs">served {window}</span>
                      ) : null}
                    </span>
                  </label>
                </div>
                {isSelected && addOn.priceType === AddOnPriceType.PER_PERSON ? (
                  <div className="flex items-center gap-2">
                    <div className="flex items-center rounded-lg border border-gray-200">
                      <button
                        type="button"
                        onClick={() => onSetQuantity(addOn.slug, quantity - 1)}
                        disabled={quantity <= minimumCovers}
                        aria-label={`Fewer ${addOn.name}`}
                        className="px-2.5 py-1 text-[#000643] text-lg leading-none disabled:cursor-not-allowed disabled:text-gray-300">
                        −
                      </button>
                      <span className="w-8 text-center font-medium text-sm tabular-nums">{quantity}</span>
                      <button
                        type="button"
                        onClick={() => onSetQuantity(addOn.slug, Math.min(roomCapacity, quantity + 1))}
                        disabled={quantity >= roomCapacity}
                        aria-label={`More ${addOn.name}`}
                        className="px-2.5 py-1 text-[#000643] text-lg leading-none disabled:cursor-not-allowed disabled:text-gray-300">
                        +
                      </button>
                    </div>
                    {/* Stopping here beats refusing at checkout. The server
                        rejects more covers than seats, but it did so only once
                        everything else had been configured — so the buyer had
                        chosen a slot, added extras and pressed pay before being
                        told the number was impossible. */}
                    <span className="w-32 whitespace-nowrap text-gray-400 text-xs">
                      people{" "}
                      <span className={quantity >= roomCapacity ? "" : "invisible"}>
                        &middot; room seats {roomCapacity}
                      </span>
                    </span>
                  </div>
                ) : null}
              </div>
              {/* Shown, not hidden behind an icon. The caterer's description is
                  what the buyer is choosing between — three lunches differ only
                  in what is in the box — so putting it one click away made the
                  list unreadable. */}
              {addOn.description ? (
                <div className="mt-2 border-gray-100 border-t pt-2 text-gray-500 text-xs leading-relaxed">
                  <AddOnDescription text={addOn.description} />
                  {perPerson ? (
                    <p className="mt-1.5 text-gray-400">
                      Minimum {minimumCovers} people, up to the {roomCapacity} this room seats.
                    </p>
                  ) : null}
                </div>
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

  // Restore what this exhibitor was considering before they left to compare
  // another room. Availability is re-read from the server on every load, so a
  // remembered slot is only put back if it is still bookable for that duration;
  // otherwise the day, duration and add-ons survive and they just re-pick a
  // time. Runs once — after that the state on screen is the truth.
  const restored = useRef(false);
  useEffect(() => {
    if (restored.current) return;
    restored.current = true;
    const saved = getSelection(room.slug);
    if (!saved) return;

    const duration = ([1, 2, 3] as DurationHours[]).includes(saved.durationHours as DurationHours)
      ? (saved.durationHours as DurationHours)
      : 1;
    setSelectedDuration(duration);

    const savedDay = days.find((d) => d.date === saved.date);
    if (savedDay) setSelectedDate(savedDay.date);

    const start = savedDay?.starts.find((s) => s.startUtc === saved.startUtc);
    if (start?.availableDurations.includes(duration)) setSelectedStartUtc(start.startUtc);

    // Drop add-ons that have since left the catalogue rather than sending a
    // slug the server will reject at checkout.
    const stillOffered = Object.fromEntries(
      Object.entries(saved.addOns).filter(([slug]) => addOnsBySlug.has(slug))
    );
    if (Object.keys(stillOffered).length) setSelectedAddOns(stillOffered);
  }, [room.slug, days, addOnsBySlug]);

  const createBooking = trpc.viewer.rooms.createBooking.useMutation();
  // One room per exhibitor per day. Enforced in the order service; asked for
  // here so the rule is visible before the buyer commits to a slot.
  const bookedDays = trpc.viewer.rooms.myBookedDays.useQuery(undefined, { enabled: isAuthed });

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
  // The chosen slot in event-local minutes, so an add-on's serving window can be
  // compared against it without pulling dates in.
  const addOnSlot: SlotWindow | null =
    selectedStartUtc && selectedDuration
      ? (() => {
          const startMinute = eventMinuteOfDay(new Date(selectedStartUtc));
          return { startMinute, endMinute: startMinute + selectedDuration * 60 };
        })()
      : null;

  // Moving the slot can take an add-on out of its serving hours. Drop it rather
  // than carrying a selection the server will refuse: the exhibitor picked lunch
  // for a midday slot, then moved to 09:00, and would only find out at payment.
  useEffect(() => {
    if (!addOnSlot) return;
    setSelectedAddOns((current) => {
      const kept = Object.fromEntries(
        Object.entries(current).filter(([slug]) => {
          const addOn = addOnsBySlug.get(slug);
          return !addOn || isAddOnOfferedDuring(addOn, addOnSlot);
        })
      );
      // Same object unless something actually went, so this cannot loop.
      return Object.keys(kept).length === Object.keys(current).length ? current : kept;
    });
  }, [addOnSlot?.startMinute, addOnSlot?.endMinute, addOnsBySlug]);

  const dayAlreadyBooked = (bookedDays.data?.days ?? []).includes(selectedDate);
  const RoomIcon = roomIconFor(room.category);
  const canBook =
    Boolean(selectedStartUtc && selectedDuration) && !createBooking.isPending && !dayAlreadyBooked;

  // Remember the selection as it changes, so leaving to compare another room
  // does not throw the work away. Skipped until the restore has run, or the
  // page's default state would overwrite what we are about to put back.
  useEffect(() => {
    if (!restored.current) return;
    saveSelection({
      slug: room.slug,
      roomName: room.name,
      date: selectedDate,
      startUtc: selectedStartUtc,
      durationHours: selectedDuration,
      addOns: selectedAddOns,
      // Priced here, where the catalogue and the duration are known, so the
      // panel never has to re-derive a price it might get wrong.
      addOnLines: addOnLines.map((l) => ({
        slug: l.slug,
        name: l.label,
        quantity: selectedAddOns[l.slug] ?? 1,
        lineTotal: l.lineTotal,
      })),
      total: total ?? 0,
      currency: room.currency,
    });
  }, [
    room.slug,
    room.name,
    room.currency,
    selectedDate,
    selectedStartUtc,
    selectedDuration,
    selectedAddOns,
    total,
  ]);

  const addOnsPayload = useMemo(
    () => Object.entries(selectedAddOns).map(([slug, quantity]) => ({ slug, quantity })),
    [selectedAddOns]
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
      // Start at the caterer's minimum rather than at 1: one cover is not a
      // thing that can be ordered, and offering it only to refuse it at payment
      // would be the same trap as the serving hours.
      if (checked) {
        const addOn = addOnsBySlug.get(slug);
        next[slug] =
          addOn?.priceType === AddOnPriceType.PER_PERSON ? minimumCoversFor(room.category) : 1;
      }
      else delete next[slug];
      return next;
    });
  }

  function setQuantity(slug: string, quantity: number): void {
    // Clamped here too, not only on the buttons: a restored shortlist can carry
    // a quantity from before the room's capacity was edited down.
    const addOn = addOnsBySlug.get(slug);
    const floor =
      addOn?.priceType === AddOnPriceType.PER_PERSON ? minimumCoversFor(room.category) : 1;
    const capped = Math.min(room.capacity, Math.max(floor, quantity));
    setSelectedAddOns((prev) => ({ ...prev, [slug]: capped }));
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
          // The room is now held and heading to payment: it stops being
          // something they are still considering.
          clearSelection(room.slug);
          if (data.checkoutUrl) window.location.href = data.checkoutUrl;
        },
      }
    );
  }

  return (
    <div>
      <div>
        <a href="/rooms" className="text-gray-500 text-sm hover:text-[#000643]">
          ← All rooms
        </a>
        <h1 className="mt-2 flex items-center gap-2 font-bold text-2xl text-[#000643]">
          <RoomIcon className="h-6 w-6 shrink-0" aria-hidden />
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

        {/* The admin's own words about this room. It was stored, used for the
            page's meta description, and shown to nobody — so anything typed
            there simply disappeared. whitespace-pre-line keeps the paragraphs
            as they were typed. */}
        {room.description?.trim() ? (
          <p className="mt-3 whitespace-pre-line text-gray-600 text-sm">{room.description}</p>
        ) : null}

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
                  <span className={`ml-1.5 font-semibold ${isSelected ? "text-white/90" : "text-green-700"}`}>
                    −{discount}%
                  </span>
                ) : null}
              </button>
            );
          })}
        </div>
        {/* The last sentence matters commercially: two separate 1h bookings do
            not earn the 2h price, and buyers do ask. */}
        <p className="mt-2 max-w-prose text-gray-500 text-xs leading-relaxed">{EXTENDED_USE_DISCOUNT_NOTE}</p>

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
          roomCapacity={room.capacity}
          roomCategory={room.category}
          slot={addOnSlot}
          onToggle={toggleAddOn}
          onSetQuantity={setQuantity}
        />
      </div>

      {/* What is left of the old "Your selection" box: the price, the VAT and
          the pay button now live in the shortlist panel, which follows the
          buyer around. Only the two things that stop a booking stay here, and
          only when they apply. */}
      {!isAuthed ? (
        <div className="mt-6 rounded-xl border border-gray-200 bg-white p-5">
          <p className="text-gray-600 text-sm">Log in to book a meeting room.</p>
          <a
            href={`/rooms/login?callbackUrl=/rooms/${room.slug}`}
            className="mt-3 block w-full rounded-lg bg-[#000643] px-4 py-2.5 text-center font-semibold text-sm text-white transition hover:opacity-90">
            Log in to book
          </a>
        </div>
      ) : !billingComplete ? (
        <div className="mt-6 rounded-xl border border-amber-200 bg-amber-50 p-5">
          <p className="text-amber-800 text-sm">
            Add your billing details first — they appear on your invoice.
          </p>
          <a
            href="/rooms/account"
            className="mt-3 block w-full rounded-lg bg-[#000643] px-4 py-2.5 text-center font-semibold text-sm text-white transition hover:opacity-90">
            Complete billing details
          </a>
        </div>
      ) : dayAlreadyBooked ? (
        <div className="mt-6 rounded-xl border border-amber-200 bg-amber-50 p-5">
          <p className="text-amber-800 text-sm">
            You already have a meeting room that day. Each exhibitor can book one room per day,
            whatever the time — pick another day, or cancel the room you have.
          </p>
          <a
            href="/rooms/bookings"
            className="mt-3 block w-full rounded-lg border border-[#000643] px-4 py-2.5 text-center font-semibold text-[#000643] text-sm transition hover:bg-[#000643]/5">
            See my bookings
          </a>
        </div>
      ) : null}
    </div>
  );
}
