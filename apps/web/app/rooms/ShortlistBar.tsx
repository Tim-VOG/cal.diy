"use client";

import { EVENT_TIME_ZONE } from "@calcom/features/ne26-rooms/lib/eventSchedule";
import { trpc } from "@calcom/trpc/react";
import { ChevronDown, CreditCard, Plus, Trash2 } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import {
  SELECTIONS_CHANGED,
  clearSelection,
  listSelections,
  type RoomSelection,
} from "./selectionStore";

/** Sections that are not shopping: the bar has no business there. */
const HIDDEN_PREFIXES = ["/rooms/admin", "/rooms/desk", "/rooms/login", "/rooms/signup"];

/** The event day a selection falls on, in the event's own time zone. */
function eventDay(selection: RoomSelection): string {
  if (!selection.startUtc) return selection.date;
  // en-CA gives ISO order (YYYY-MM-DD), which is what the server compares on.
  return new Intl.DateTimeFormat("en-CA", { timeZone: EVENT_TIME_ZONE }).format(
    new Date(selection.startUtc)
  );
}

function formatPrice(cents: number, currency: string): string {
  return new Intl.NumberFormat("en-GB", { style: "currency", currency }).format(cents / 100);
}

function dayLabel(isoDate: string): string {
  // Noon avoids any edge where a midnight instant lands on the previous day.
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: EVENT_TIME_ZONE,
    weekday: "short",
    day: "numeric",
    month: "short",
  }).format(new Date(`${isoDate}T12:00:00.000Z`));
}

function formatSlot(selection: RoomSelection): string {
  if (!selection.startUtc) return `${selection.durationHours}h — no time picked yet`;
  const start = new Date(selection.startUtc);
  const end = new Date(start.getTime() + selection.durationHours * 60 * 60 * 1000);
  const time = (d: Date) =>
    new Intl.DateTimeFormat("en-GB", {
      timeZone: EVENT_TIME_ZONE,
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).format(d);
  return `${dayLabel(eventDay(selection))}, ${time(start)}–${time(end)}`;
}

/**
 * The shortlist, following the exhibitor across the site.
 *
 * It used to sit on the listing page only, so the moment you opened a room to
 * configure it you lost sight of what you had already lined up — and there was
 * nothing anywhere inviting you to book a second day. It is a sticky strip
 * rather than a panel so it costs no layout on a phone, and it stays collapsed
 * until asked: the point is a running total you can glance at, not a page.
 *
 * Nothing here is a booking. No room is held until payment, and it says so.
 */
export default function ShortlistBar({ eventDays }: { eventDays: string[] }): JSX.Element | null {
  const pathname = usePathname();
  // Read after mount: sessionStorage does not exist during the server render,
  // and reading it while rendering would desync hydration.
  const [selections, setSelections] = useState<RoomSelection[] | null>(null);
  const [open, setOpen] = useState(false);

  const refresh = useCallback(() => setSelections(listSelections()), []);
  useEffect(() => {
    refresh();
    // The bar lives in the layout and never remounts on client-side navigation,
    // so it has to be told when the page beneath it changes the shortlist.
    globalThis.addEventListener(SELECTIONS_CHANGED, refresh);
    return () => globalThis.removeEventListener(SELECTIONS_CHANGED, refresh);
  }, [refresh]);

  // One room per exhibitor per day. Enforced server-side; surfaced here so the
  // clash is visible while it can still be fixed, not as a refusal at payment.
  const bookedDays = trpc.viewer.rooms.myBookedDays.useQuery();
  const pay = trpc.viewer.rooms.createOrder.useMutation({
    onSuccess: (data) => {
      if (data.checkoutUrl) window.location.href = data.checkoutUrl;
    },
  });

  if (HIDDEN_PREFIXES.some((p) => pathname?.startsWith(p))) return null;
  if (!selections?.length) return null;

  const total = selections.reduce((sum, s) => sum + s.total, 0);
  const currency = selections[0].currency;
  const sameCurrency = selections.every((s) => s.currency === currency);

  function forget(slug: string): void {
    clearSelection(slug);
    refresh();
  }

  // A shortlist entry with no time picked is not payable yet, but it stays on
  // the list rather than blocking the others.
  const payable = selections.filter((s) => s.startUtc);

  const alreadyBooked = new Set(bookedDays.data?.days ?? []);
  const seenDays = new Set<string>();
  const clashing = new Set<string>();
  for (const selection of payable) {
    const day = eventDay(selection);
    if (alreadyBooked.has(day) || seenDays.has(day)) clashing.add(selection.slug);
    seenDays.add(day);
  }

  const canPay = payable.length > 0 && sameCurrency && clashing.size === 0;
  // Days with neither a booking nor a shortlisted room: what "another day" means.
  const freeDays = eventDays.filter((d) => !alreadyBooked.has(d) && !seenDays.has(d));

  return (
    <div className="sticky bottom-0 z-40 border-[#000643]/15 border-t bg-white/95 shadow-[0_-4px_16px_rgba(0,6,67,0.08)] backdrop-blur">
      <div className="mx-auto w-full max-w-6xl px-4 sm:px-6">
        {open ? (
          <div className="max-h-[45vh] overflow-y-auto py-3">
            <ul className="divide-y divide-[#000643]/10">
              {selections.map((selection) => (
                <li key={selection.slug} className="flex items-center justify-between gap-3 py-2">
                  <Link href={`/rooms/${selection.slug}`} className="group min-w-0 flex-1">
                    <span className="block truncate font-medium text-[#000643] text-sm group-hover:underline">
                      {selection.roomName}
                    </span>
                    <span className="block truncate text-gray-500 text-xs">{formatSlot(selection)}</span>
                    {clashing.has(selection.slug) ? (
                      <span className="mt-0.5 block text-amber-700 text-xs">
                        You already have a room that day — pick another day or remove this one.
                      </span>
                    ) : null}
                  </Link>
                  <span className="shrink-0 font-medium text-[#000643] text-sm">
                    {formatPrice(selection.total, selection.currency)}
                  </span>
                  <button
                    type="button"
                    onClick={() => forget(selection.slug)}
                    aria-label={`Remove ${selection.roomName} from your shortlist`}
                    className="shrink-0 rounded-md p-1.5 text-gray-400 transition hover:bg-[#000643]/5 hover:text-[#000643]">
                    <Trash2 className="h-4 w-4" aria-hidden />
                  </button>
                </li>
              ))}
            </ul>

            {freeDays.length > 0 ? (
              <Link
                href="/rooms"
                onClick={() => setOpen(false)}
                className="mt-3 flex items-center justify-center gap-2 rounded-lg border border-[#000643]/25 border-dashed px-4 py-2.5 font-medium text-[#000643] text-sm transition hover:bg-[#000643]/5">
                <Plus className="h-4 w-4 shrink-0" aria-hidden />
                Do you want to add a booking for another day?
                <span className="hidden text-gray-500 sm:inline">
                  ({freeDays.map(dayLabel).join(", ")} still open)
                </span>
              </Link>
            ) : (
              <p className="mt-3 text-center text-gray-500 text-xs">
                You have a room for every day of the event.
              </p>
            )}

            {clashing.size > 0 ? (
              <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-amber-800 text-sm">
                Each exhibitor can book one meeting room per day, whatever the time. Adjust the day
                marked above and you can pay for the rest together.
              </p>
            ) : null}

            <p className="mt-3 text-center text-gray-400 text-xs">
              Nothing is held until you reach the payment page. Amounts exclude VAT, which is
              determined at checkout from your billing country and VAT number.
            </p>
            {pay.error ? (
              <p className="mt-2 rounded-lg bg-red-50 px-3 py-2 text-red-700 text-sm">
                {pay.error.message}
              </p>
            ) : null}
          </div>
        ) : null}

        {/* The strip itself: total on the left, the two actions on the right.
            It wraps on a narrow phone rather than shrinking the pay button. */}
        <div className="flex flex-wrap items-center justify-between gap-3 py-3">
          <button
            type="button"
            onClick={() => setOpen((o) => !o)}
            aria-expanded={open}
            className="flex min-w-0 items-center gap-2 text-left">
            <ChevronDown
              className={`h-4 w-4 shrink-0 text-[#000643] transition-transform ${open ? "" : "rotate-180"}`}
              aria-hidden
            />
            <span className="min-w-0">
              <span className="block font-semibold text-[#000643] text-sm">
                {selections.length === 1 ? "1 room shortlisted" : `${selections.length} rooms shortlisted`}
              </span>
              <span className="block text-gray-500 text-xs">
                {sameCurrency ? `${formatPrice(total, currency)} excl. VAT` : "Mixed currencies"}
                {clashing.size > 0 ? " · 1 day needs changing" : ""}
              </span>
            </span>
          </button>

          {/* Full width on a phone so it wraps onto its own line with both
              actions side by side, rather than squeezing "Another day" out —
              inviting the next day's booking is the whole point of the bar. */}
          <div className="flex w-full items-center justify-end gap-2 sm:w-auto sm:flex-1">
            {!open && freeDays.length > 0 ? (
              <Link
                href="/rooms"
                className="flex flex-1 shrink-0 items-center justify-center gap-1.5 rounded-lg border border-[#000643]/25 px-3 py-2.5 font-medium text-[#000643] text-sm transition hover:bg-[#000643]/5 sm:flex-none">
                <Plus className="h-4 w-4 shrink-0" aria-hidden />
                Another day
              </Link>
            ) : null}
            <button
              type="button"
              disabled={!canPay || pay.isPending}
              onClick={() =>
                pay.mutate({
                  rooms: payable.map((s) => ({
                    slug: s.slug,
                    startUtc: s.startUtc as string,
                    durationHours: s.durationHours as 1 | 2 | 3,
                    addOns: Object.entries(s.addOns).map(([slug, quantity]) => ({ slug, quantity })),
                  })),
                })
              }
              className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-[#000643] px-4 py-2.5 font-semibold text-sm text-white transition hover:opacity-90 disabled:opacity-40 sm:flex-none">
              <CreditCard className="h-4 w-4 shrink-0" aria-hidden />
              {pay.isPending
                ? "Holding…"
                : payable.length === 1
                  ? "Pay for this room"
                  : `Pay for all ${payable.length} rooms`}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
