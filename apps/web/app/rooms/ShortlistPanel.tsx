"use client";

import { EVENT_TIME_ZONE } from "@calcom/features/ne26-rooms/lib/eventSchedule";
import { trpc } from "@calcom/trpc/react";
import { ChevronDown, ChevronUp, Clock, CreditCard, Plus, Trash2 } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  SELECTIONS_CHANGED,
  clearAllSelections,
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
function Countdown({
  expiresAt,
  onExpired,
}: {
  expiresAt: string;
  onExpired: () => void;
}): JSX.Element | null {
  const target = new Date(expiresAt).getTime();
  const [msLeft, setMsLeft] = useState<number | null>(null);
  // The clock reaching zero used to change nothing but the words on it: the
  // hold was gone, the rooms were back on sale, and the panel went on offering
  // to pay for them until the next background refetch, up to a minute later.
  const fired = useRef(false);
  useEffect(() => {
    const tick = () => {
      const left = target - Date.now();
      setMsLeft(left);
      if (left <= 0 && !fired.current) {
        fired.current = true;
        onExpired();
      }
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [target, onExpired]);

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
  // Paying an existing hold resumes THAT order rather than creating a second
  // one: what is held is what is paid for, even if the shortlist has moved on.
  const resume = trpc.viewer.rooms.resumeOrder.useMutation({
    onSuccess: (data) => {
      if (data.checkoutUrl) window.location.href = data.checkoutUrl;
    },
  });
  const takeHold = trpc.viewer.rooms.holdRooms.useMutation({
    onSuccess: () => {
      void pending.refetch();
    },
  });
  // Giving up a hold has to be as easy as taking one. Without it the only exit
  // was to wait out the clock, with the rooms unbookable by anyone meanwhile.
  /**
   * On a phone the shortlist is a sheet, closed until it is wanted.
   *
   * Open, it filled most of a 402px screen: two rooms with their add-ons, the
   * VAT breakdown, two buttons and three lines of explanation stood between
   * the exhibitor and the rooms they were still choosing between. Closed, it
   * is one bar saying how many rooms and how much.
   */
  const [sheetOpen, setSheetOpen] = useState(false);
  const seenSlugs = useRef<string[] | null>(null);
  // Opening a room page rewrites its own selection as the page restores it,
  // which churns the store several times in the first moment. Counting any of
  // that as "the exhibitor added a room" opened the sheet on every page load.
  // Nothing auto-opens until the dust settles.
  const settled = useRef(false);
  useEffect(() => {
    const id = setTimeout(() => {
      settled.current = true;
    }, 1200);
    return () => clearTimeout(id);
  }, []);
  useEffect(() => {
    if (selections === null) return;
    const slugs = selections.map((s) => s.slug);
    const before = seenSlugs.current;
    // A room that was not there before — an addition, not a re-save. The moment
    // the shortlist gains something is exactly the moment it is worth showing.
    if (settled.current && before !== null && slugs.some((slug) => !before.includes(slug))) {
      setSheetOpen(true);
    }
    seenSlugs.current = slugs;
  }, [selections]);

  // Room at the bottom of the page for the closed bar, so the last line of the
  // footer is not permanently underneath it. Phones only: on a wide screen the
  // panel is parked to the right and covers nothing.
  const showsSheet = !hidden && ((selections?.length ?? 0) > 0 || Boolean(pending.data));
  useEffect(() => {
    if (!showsSheet) return;
    const narrow = globalThis.matchMedia?.("(max-width: 1279px)");
    const apply = () => {
      document.body.style.paddingBottom = narrow?.matches ? "4.75rem" : "";
    };
    apply();
    narrow?.addEventListener("change", apply);
    return () => {
      narrow?.removeEventListener("change", apply);
      document.body.style.paddingBottom = "";
    };
  }, [showsSheet]);

  // What to do when the clock runs out. The rooms are back on sale, so the
  // shortlist that was holding them is no longer a basket anyone can pay for.
  const [lapsed, setLapsed] = useState(false);
  const onHoldExpired = useCallback(() => {
    clearAllSelections();
    setLapsed(true);
    void pending.refetch();
    void bookedDays.refetch();
    globalThis.dispatchEvent(new Event(SELECTIONS_CHANGED));
  }, [pending.refetch, bookedDays.refetch]);

  const release = trpc.viewer.rooms.releaseMyHold.useMutation({
    onSuccess: () => {
      void pending.refetch();
      void bookedDays.refetch();
    },
  });

  if (hidden) return null;
  const heldOrder = pending.data;
  // Stay on screen with nothing left to show, just long enough to say why the
  // shortlist emptied itself. Vanishing silently would read as a bug.
  if (!selections?.length && !heldOrder && !lapsed) return null;

  const currency = selections?.[0]?.currency ?? heldOrder?.currency ?? "EUR";
  const sameCurrency = (selections ?? []).every((s) => s.currency === currency);

  function forget(slug: string): void {
    clearSelection(slug);
    refresh();
  }

  // One room per exhibitor per day, surfaced while it can still be fixed.
  // Only a room they have PAID for blocks the day. A day they are merely
  // holding is their own basket: paying for the shortlist replaces it, so
  // flagging it as a clash locked the exhibitor out of their own purchase.
  const alreadyBooked = new Set(bookedDays.data?.days ?? []);
  const heldDays = new Set(bookedDays.data?.heldDays ?? []);
  const seenDays = new Set<string>();
  const clashing = new Set<string>();
  const replacing = new Set<string>();
  for (const s of payable) {
    const day = eventDay(s);
    if (alreadyBooked.has(day) || seenDays.has(day)) clashing.add(s.slug);
    else if (heldDays.has(day)) replacing.add(s.slug);
    seenDays.add(day);
  }
  const canPay = payable.length > 0 && sameCurrency && clashing.size === 0;
  const basketPayload = payable.map((s) => ({
    slug: s.slug,
    startUtc: s.startUtc as string,
    durationHours: s.durationHours as 1 | 2 | 3,
    addOns: Object.entries(s.addOns).map(([slug, quantity]) => ({ slug, quantity })),
  }));
  const freeDays = eventDays.filter((d) => !alreadyBooked.has(d) && !seenDays.has(d));
  const subtotal = (selections ?? []).reduce((sum, s) => sum + s.total, 0);

  /**
   * The server's quote, but only when it covers the whole basket.
   *
   * previewOrderVat reports how many rooms it managed to price. When it prices
   * fewer than were sent — a slot that has since gone, an add-on withdrawn — it
   * still returns totals, for the rooms it could price. Those totals were being
   * shown as THE total: a basket it could price none of displayed "Total €0.00"
   * directly beneath two rooms listed at €646 and €534, with the Pay button
   * live underneath. Falling back to the prices the rooms were saved at is both
   * honest and closer to what will be charged.
   */
  const quoted = vat.data && vat.data.pricedRooms === payable.length ? vat.data : null;
  const totalHt = quoted ? quoted.totalHt : subtotal;
  const totalTtc = quoted ? quoted.totalTtc : subtotal;

  // What the closed bar says: how many rooms, and what they come to.
  const sheetBadge = payable.length || heldOrder?.rooms || 0;
  const sheetSummary =
    payable.length > 0
      ? `${payable.length} room${payable.length > 1 ? "s" : ""} · ${money(totalTtc, currency)}`
      : heldOrder
        ? `${heldOrder.rooms} room${heldOrder.rooms > 1 ? "s" : ""} held`
        : "Your shortlist";

  const body = (
    <>
      {lapsed ? (
        <div className="mb-3 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2">
          <p className="text-gray-700 text-xs leading-snug">
            Your hold ran out and the rooms went back on sale. Your shortlist was cleared — the rooms
            may well still be free.
          </p>
          <div className="mt-2 flex gap-3">
            <Link href="/rooms" className="font-semibold text-[#000643] text-xs underline">
              Look again
            </Link>
            <button
              type="button"
              onClick={() => setLapsed(false)}
              className="text-gray-500 text-xs underline">
              Dismiss
            </button>
          </div>
        </div>
      ) : null}
      {heldOrder ? (
        <div className="mb-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2">
          <p className="flex items-center gap-1.5 text-amber-900 text-xs">
            <Clock className="h-3.5 w-3.5 shrink-0" aria-hidden />
            <Countdown expiresAt={heldOrder.holdExpiresAt} onExpired={onHoldExpired} />
          </p>
          <p className="mt-0.5 text-amber-800 text-xs">
            {heldOrder.rooms === 1 ? "1 room is held" : `${heldOrder.rooms} rooms are held`} for{" "}
            {money(heldOrder.amountTotal, heldOrder.currency)} excl. VAT.
          </p>
          <button
            type="button"
            disabled={resume.isPending}
            onClick={() => resume.mutate({ uid: heldOrder.uid })}
            className="mt-2 flex w-full items-center justify-center gap-2 rounded-lg bg-[#000643] px-3 py-2 font-semibold text-sm text-white transition hover:opacity-90 disabled:opacity-40">
            <CreditCard className="h-4 w-4 shrink-0" aria-hidden />
            {resume.isPending ? "Opening payment…" : "Pay for the rooms you are holding"}
          </button>
          <button
            type="button"
            disabled={release.isPending}
            onClick={() => release.mutate({ uid: heldOrder.uid })}
            className="mt-1.5 w-full text-amber-800 text-xs underline underline-offset-2 transition hover:text-amber-900 disabled:opacity-40">
            {release.isPending ? "Releasing…" : "Release these rooms"}
          </button>
          {resume.error ? (
            <p className="mt-1.5 text-red-700 text-xs">{resume.error.message}</p>
          ) : null}
          {release.error ? (
            <p className="mt-1.5 text-red-700 text-xs">{release.error.message}</p>
          ) : null}
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
                        {/* The label already carries its own multiplier, and
                            carries the right one: per person reads "x 6",
                            per hour "x 2h". Appending the raw quantity here
                            printed "Breakfast x 6 x 6". */}
                        <span className="min-w-0 flex-1 truncate">{line.name}</span>
                        <span className="shrink-0 tabular-nums">
                          {money(line.lineTotal, s.currency)}
                        </span>
                      </li>
                    ))}
                  </ul>
                ) : null}

                {clashing.has(s.slug) ? (
                  <p className="mt-1 text-amber-700 text-xs">You already have a room that day.</p>
                ) : replacing.has(s.slug) ? (
                  <p className="mt-1 text-gray-400 text-xs">Replaces the room you hold that day.</p>
                ) : null}
              </li>
            ))}
          </ul>

          {/* The whole quote, no unfolding: what it costs, what VAT is added,
              what will actually be charged. */}
          <dl className="mt-2 space-y-1 border-[#000643]/10 border-t pt-2 text-sm">
            <div className="flex justify-between text-gray-600">
              <dt>Excl. VAT</dt>
              <dd className="tabular-nums">{money(totalHt, currency)}</dd>
            </div>
            {quoted && quoted.totalVat > 0 ? (
              <div className="flex justify-between text-gray-500 text-xs">
                <dt>VAT</dt>
                <dd className="tabular-nums">{money(quoted.totalVat, currency)}</dd>
              </div>
            ) : null}
            {quoted?.zeroRated && quoted.mention ? (
              <p className="text-gray-400 text-xs leading-snug">{quoted.mention}</p>
            ) : null}
            <div className="flex justify-between border-[#000643]/10 border-t pt-1 font-semibold text-[#000643]">
              <dt>Total</dt>
              <dd className="tabular-nums">
                {money(totalTtc, currency)}
              </dd>
            </div>
          </dl>

          {clashing.size > 0 ? (
            <p className="mt-2 rounded-lg bg-amber-50 px-2.5 py-2 text-amber-800 text-xs leading-snug">
              One meeting room per exhibitor per day, whatever the time. Change the day marked above
              and you can pay for the rest together.
            </p>
          ) : null}

          {/* Two deliberate acts, not one. Holding takes the rooms off sale
              while the exhibitor finishes deciding; paying is what keeps them.
              Nothing is held merely by clicking a time — with nine rooms over
              three days, a visitor comparing five of them would otherwise
              freeze five for half an hour just by looking. */}
          {!heldOrder ? (
            <button
              type="button"
              disabled={!canPay || takeHold.isPending}
              onClick={() => takeHold.mutate({ rooms: basketPayload })}
              className="mt-3 flex w-full items-center justify-center gap-2 rounded-lg border border-[#000643] px-4 py-2.5 font-semibold text-[#000643] text-sm transition hover:bg-[#000643]/5 disabled:opacity-40">
              <Clock className="h-4 w-4 shrink-0" aria-hidden />
              {takeHold.isPending
                ? "Holding…"
                : payable.length === 1
                  ? "Hold this room"
                  : `Hold these ${payable.length} rooms`}
            </button>
          ) : null}
          {takeHold.error ? (
            <p className="mt-2 rounded-lg bg-red-50 px-2.5 py-2 text-red-700 text-xs">
              {takeHold.error.message}
            </p>
          ) : null}

          <button
            type="button"
            disabled={!canPay || pay.isPending}
            onClick={() => pay.mutate({ rooms: basketPayload })}
            className="mt-2 flex w-full items-center justify-center gap-2 rounded-lg bg-[#000643] px-4 py-2.5 font-semibold text-sm text-white transition hover:opacity-90 disabled:opacity-40">
            <CreditCard className="h-4 w-4 shrink-0" aria-hidden />
            {pay.isPending
              ? "Opening payment…"
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

          <p className="mt-2 text-gray-400 text-xs leading-snug">
            {heldOrder
              ? "Your rooms are reserved until the clock above runs out. If the payment has not gone through by then, they go back on sale."
              : "Holding takes these rooms off sale for 35 minutes so you can finish deciding. If you have not paid by then, they go back on sale."}
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

      {/* Narrower screens: a sheet pinned to the viewport, closed by default.
          It was `sticky`, which meant it stopped being pinned the moment the
          page ran out — so scrolling to the bottom carried it down into the
          footer instead of leaving it where it belongs. `fixed` keeps it put,
          and the body reserves the closed bar's height so the footer's last
          line is still reachable underneath it. */}
      <div className="fixed inset-x-0 bottom-0 z-40 border-[#000643]/15 border-t bg-white/95 shadow-[0_-4px_16px_rgba(0,6,67,0.08)] backdrop-blur xl:hidden">
        <div className="mx-auto w-full max-w-6xl">
          <button
            type="button"
            onClick={() => setSheetOpen((v) => !v)}
            aria-expanded={sheetOpen}
            className="flex w-full items-center gap-3 px-4 py-3 text-left sm:px-6">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#000643] font-semibold text-sm text-white">
              {sheetBadge}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate font-semibold text-[#000643] text-sm">
                {sheetSummary}
              </span>
              {/* The clock is the one thing that must never be folded away. When
                  the sheet is open the amber box carries it, so it is rendered
                  here only while it is closed — one countdown, never two. */}
              <span className="block truncate text-gray-500 text-xs">
                {!sheetOpen && heldOrder ? (
                  <Countdown expiresAt={heldOrder.holdExpiresAt} onExpired={onHoldExpired} />
                ) : (
                  "Tap to review and pay"
                )}
              </span>
            </span>
            {sheetOpen ? (
              <ChevronDown className="h-5 w-5 shrink-0 text-[#000643]" aria-hidden />
            ) : (
              <ChevronUp className="h-5 w-5 shrink-0 text-[#000643]" aria-hidden />
            )}
          </button>

          {sheetOpen ? (
            <div className="max-h-[65vh] overflow-y-auto border-[#000643]/10 border-t px-4 pt-3 pb-4 sm:px-6">
              {body}
            </div>
          ) : null}
        </div>
      </div>
    </>
  );
}
