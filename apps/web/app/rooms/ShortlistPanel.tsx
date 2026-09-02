"use client";

import { EVENT_TIME_ZONE } from "@calcom/features/ne26-rooms/lib/eventSchedule";
import { trpc } from "@calcom/trpc/react";
import { Clock, CreditCard, Plus, Trash2 } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import {
  SELECTIONS_CHANGED,
  clearSelection,
  listSelections,
  type RoomSelection,
} from "./selectionStore";

/** Sections that are not shopping: the panel has no business there. */
const HIDDEN_PREFIXES = ["/rooms/admin", "/rooms/desk", "/rooms/login", "/rooms/signup"];

function eventDay(selection: RoomSelection): string {
  if (!selection.startUtc) return selection.date;
  return new Intl.DateTimeFormat("en-CA", { timeZone: EVENT_TIME_ZONE }).format(
    new Date(selection.startUtc)
  );
}
function money(cents: number, currency: string): string {
  return new Intl.NumberFormat("en-GB", { style: "currency", currency }).format(cents / 100);
}
function dayLabel(isoDate: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: EVENT_TIME_ZONE,
    weekday: "short",
    day: "numeric",
    month: "short",
  }).format(new Date(`${isoDate}T12:00:00.000Z`));
}
function slotLabel(selection: RoomSelection): string {
  if (!selection.startUtc) return `${selection.durationHours}h — no time picked`;
  const start = new Date(selection.startUtc);
  const end = new Date(start.getTime() + selection.durationHours * 60 * 60 * 1000);
  const t = (d: Date) =>
    new Intl.DateTimeFormat("en-GB", {
      timeZone: EVENT_TIME_ZONE,
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).format(d);
  return `${dayLabel(eventDay(selection))} · ${t(start)}–${t(end)}`;
}

/**
 * The clock on an unpaid hold, ticking.
 *
 * Rendered where the buyer already is. It used to live on "My bookings", which
 * is where people go after paying — so the one number with a deadline on it was
 * on the page nobody opens while it is running.
 */
function Countdown({ expiresAt }: { expiresAt: string }): JSX.Element | null {
  const target = new Date(expiresAt).getTime();
  const [msLeft, setMsLeft] = useState<number | null>(null);
  useEffect(() => {
    const tick = () => setMsLeft(target - Date.now());
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [target]);

  // Null until mounted: the server has no clock the buyer can trust.
  if (msLeft === null) return null;
  if (msLeft <= 0) return <span className="font-medium text-red-600">Hold expired</span>;
  const total = Math.floor(msLeft / 1000);
  return (
    <span className={`font-medium tabular-nums ${msLeft < 5 * 60_000 ? "text-red-600" : ""}`}>
      {Math.floor(total / 60)}:{String(total % 60).padStart(2, "0")} left to pay
    </span>
  );
}

/**
 * Everything the exhibitor has lined up, always in view and always open.
 *
 * It began as a strip along the bottom that had to be unfolded to say anything
 * useful, which put the total, the clock and the day-clash warnings behind a
 * click. Now it is a panel: on a wide screen it sits to the right of the page
 * and stays there while you scroll; on a phone it is pinned to the bottom. In
 * both, everything is legible without opening anything.
 *
 * It also replaces the per-room "Your selection" box, so there is one place
 * showing what is being bought and what it costs, rather than two that could
 * disagree.
 */
export default function ShortlistPanel({ eventDays }: { eventDays: string[] }): JSX.Element | null {
  const pathname = usePathname();
  const [selections, setSelections] = useState<RoomSelection[] | null>(null);
  const refresh = useCallback(() => setSelections(listSelections()), []);
  useEffect(() => {
    refresh();
    // The panel lives in the layout and never remounts on client-side
    // navigation, so the page beneath has to tell it when the shortlist moves.
    globalThis.addEventListener(SELECTIONS_CHANGED, refresh);
    return () => globalThis.removeEventListener(SELECTIONS_CHANGED, refresh);
  }, [refresh]);

  const hidden = HIDDEN_PREFIXES.some((p) => pathname?.startsWith(p));
  const bookedDays = trpc.viewer.rooms.myBookedDays.useQuery(undefined, { enabled: !hidden });
  const pending = trpc.viewer.rooms.myPendingOrder.useQuery(undefined, {
    enabled: !hidden,
    // The hold is a clock: a stale answer here is worse than none.
    refetchInterval: 60_000,
  });

  const payable = (selections ?? []).filter((s) => s.startUtc);
  const vat = trpc.viewer.rooms.previewOrderVat.useQuery(
    {
      rooms: payable.slice(0, 10).map((s) => ({
        slug: s.slug,
        durationHours: s.durationHours as 1 | 2 | 3,
        startUtc: s.startUtc as string,
        addOns: Object.entries(s.addOns).map(([slug, quantity]) => ({ slug, quantity })),
      })),
    },
    { enabled: !hidden && payable.length > 0 }
  );

  const pay = trpc.viewer.rooms.createOrder.useMutation({
    onSuccess: (data) => {
      if (data.checkoutUrl) window.location.href = data.checkoutUrl;
    },
  });

  if (hidden) return null;
  const hold = pending.data;
  if (!selections?.length && !hold) return null;

  const currency = selections?.[0]?.currency ?? hold?.currency ?? "EUR";
  const sameCurrency = (selections ?? []).every((s) => s.currency === currency);

  function forget(slug: string): void {
    clearSelection(slug);
    refresh();
  }

  // One room per exhibitor per day, surfaced while it can still be fixed.
  const alreadyBooked = new Set(bookedDays.data?.days ?? []);
  const seenDays = new Set<string>();
  const clashing = new Set<string>();
  for (const s of payable) {
    const day = eventDay(s);
    if (alreadyBooked.has(day) || seenDays.has(day)) clashing.add(s.slug);
    seenDays.add(day);
  }
  const canPay = payable.length > 0 && sameCurrency && clashing.size === 0 && !pay.isPending;
  const freeDays = eventDays.filter((d) => !alreadyBooked.has(d) && !seenDays.has(d));
  const subtotal = (selections ?? []).reduce((sum, s) => sum + s.total, 0);

  const body = (
    <>
      {hold ? (
        <div className="mb-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2">
          <p className="flex items-center gap-1.5 text-amber-900 text-xs">
            <Clock className="h-3.5 w-3.5 shrink-0" aria-hidden />
            <Countdown expiresAt={hold.holdExpiresAt} />
          </p>
          <p className="mt-0.5 text-amber-800 text-xs">
            {hold.rooms === 1 ? "1 room is held" : `${hold.rooms} rooms are held`} for{" "}
            {money(hold.amountTotal, hold.currency)} excl. VAT.
          </p>
          <Link
            href="/rooms/bookings"
            className="mt-1.5 inline-block font-semibold text-amber-900 text-xs underline">
            Finish the payment
          </Link>
        </div>
      ) : null}

      {selections?.length ? (
        <>
          <ul className="divide-y divide-[#000643]/10">
            {selections.map((s) => (
              <li key={s.slug} className="py-2">
                <div className="flex items-start gap-2">
                  <Link href={`/rooms/${s.slug}`} className="group min-w-0 flex-1">
                    <span className="block truncate font-medium text-[#000643] text-sm group-hover:underline">
                      {s.roomName}
                    </span>
                    <span className="block truncate text-gray-500 text-xs">{slotLabel(s)}</span>
                  </Link>
                  <span className="shrink-0 text-right font-medium text-[#000643] text-sm tabular-nums">
                    {money(s.total, s.currency)}
                  </span>
                  <button
                    type="button"
                    onClick={() => forget(s.slug)}
                    aria-label={`Remove ${s.roomName}`}
                    className="shrink-0 rounded p-1 text-gray-300 transition hover:bg-[#000643]/5 hover:text-[#000643]">
                    <Trash2 className="h-3.5 w-3.5" aria-hidden />
                  </button>
                </div>

                {/* Each add-on on its own line with its own total, the way the
                    room has one. A truncated "lunch x6, breakfast x12, lunc…"
                    told the buyer neither what they had ordered nor what it
                    cost. */}
                {s.addOnLines?.length ? (
                  <ul className="mt-1 space-y-0.5 pl-3">
                    {s.addOnLines.map((line) => (
                      <li
                        key={line.slug}
                        className="flex items-baseline justify-between gap-2 text-gray-500 text-xs">
                        <span className="min-w-0 flex-1 truncate">
                          {line.name} &times; {line.quantity}
                        </span>
                        <span className="shrink-0 tabular-nums">
                          {money(line.lineTotal, s.currency)}
                        </span>
                      </li>
                    ))}
                  </ul>
                ) : null}

                {clashing.has(s.slug) ? (
                  <p className="mt-1 text-amber-700 text-xs">You already have a room that day.</p>
                ) : null}
              </li>
            ))}
          </ul>

          {/* The whole quote, no unfolding: what it costs, what VAT is added,
              what will actually be charged. */}
          <dl className="mt-2 space-y-1 border-[#000643]/10 border-t pt-2 text-sm">
            <div className="flex justify-between text-gray-600">
              <dt>Excl. VAT</dt>
              <dd className="tabular-nums">{money(vat.data?.totalHt ?? subtotal, currency)}</dd>
            </div>
            {vat.data && vat.data.totalVat > 0 ? (
              <div className="flex justify-between text-gray-500 text-xs">
                <dt>VAT</dt>
                <dd className="tabular-nums">{money(vat.data.totalVat, currency)}</dd>
              </div>
            ) : null}
            {vat.data?.zeroRated && vat.data.mention ? (
              <p className="text-gray-400 text-xs leading-snug">{vat.data.mention}</p>
            ) : null}
            <div className="flex justify-between border-[#000643]/10 border-t pt-1 font-semibold text-[#000643]">
              <dt>Total</dt>
              <dd className="tabular-nums">
                {money(vat.data?.totalTtc ?? subtotal, currency)}
              </dd>
            </div>
          </dl>

          {clashing.size > 0 ? (
            <p className="mt-2 rounded-lg bg-amber-50 px-2.5 py-2 text-amber-800 text-xs leading-snug">
              One meeting room per exhibitor per day, whatever the time. Change the day marked above
              and you can pay for the rest together.
            </p>
          ) : null}

          <button
            type="button"
            disabled={!canPay}
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
            className="mt-3 flex w-full items-center justify-center gap-2 rounded-lg bg-[#000643] px-4 py-2.5 font-semibold text-sm text-white transition hover:opacity-90 disabled:opacity-40">
            <CreditCard className="h-4 w-4 shrink-0" aria-hidden />
            {pay.isPending
              ? "Holding…"
              : payable.length === 1
                ? "Pay for this room"
                : `Pay for all ${payable.length} rooms`}
          </button>

          {freeDays.length > 0 ? (
            <Link
              href="/rooms"
              className="mt-2 flex items-center justify-center gap-1.5 rounded-lg border border-[#000643]/25 border-dashed px-3 py-2 text-center font-medium text-[#000643] text-xs transition hover:bg-[#000643]/5">
              <Plus className="h-3.5 w-3.5 shrink-0" aria-hidden />
              Add a booking for another day
            </Link>
          ) : (
            <p className="mt-2 text-center text-gray-400 text-xs">
              You have a room for every day of the event.
            </p>
          )}
          {freeDays.length > 0 ? (
            <p className="mt-1 text-center text-gray-400 text-xs">
              {freeDays.map(dayLabel).join(", ")} still open
            </p>
          ) : null}

          <p className="mt-2 text-center text-gray-400 text-xs leading-snug">
            Nothing is held until you reach the payment page.
          </p>
          {pay.error ? (
            <p className="mt-2 rounded-lg bg-red-50 px-2.5 py-2 text-red-700 text-xs">
              {pay.error.message}
            </p>
          ) : null}
        </>
      ) : null}
    </>
  );

  return (
    <>
      {/* Wide screens: parked to the right of the content and kept there while
          the page scrolls. Its own scrollbar past a tall shortlist. */}
      {/* Below the two-row header rather than over it, and never taller than
          what is left of the viewport. */}
      <aside className="pointer-events-none fixed top-28 right-0 bottom-4 z-40 hidden w-[22rem] items-start justify-end p-4 xl:flex">
        <div className="pointer-events-auto max-h-full w-full overflow-y-auto rounded-xl border border-[#000643]/15 bg-white p-4 shadow-lg">
          <h2 className="mb-2 font-semibold text-[#000643] text-xs uppercase tracking-wide">
            Your shortlist
          </h2>
          {body}
        </div>
      </aside>

      {/* Narrower screens: pinned to the bottom, same content, nothing folded. */}
      <div className="sticky bottom-0 z-40 border-[#000643]/15 border-t bg-white/95 shadow-[0_-4px_16px_rgba(0,6,67,0.08)] backdrop-blur xl:hidden">
        <div className="mx-auto max-h-[60vh] w-full max-w-6xl overflow-y-auto px-4 py-3 sm:px-6">
          {body}
        </div>
      </div>
    </>
  );
}
