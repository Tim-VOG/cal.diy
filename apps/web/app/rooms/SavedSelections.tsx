"use client";

import { trpc } from "@calcom/trpc/react";
import { CreditCard, Trash2 } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { clearSelection, listSelections, type RoomSelection } from "./selectionStore";

function formatPrice(cents: number, currency: string): string {
  return new Intl.NumberFormat("en-GB", { style: "currency", currency }).format(cents / 100);
}

function formatSlot(selection: RoomSelection): string {
  if (!selection.startUtc) return `${selection.durationHours}h — no time picked yet`;
  const start = new Date(selection.startUtc);
  const end = new Date(start.getTime() + selection.durationHours * 60 * 60 * 1000);
  const day = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Istanbul",
    weekday: "short",
    day: "numeric",
    month: "short",
  }).format(start);
  const time = (d: Date) =>
    new Intl.DateTimeFormat("en-GB", {
      timeZone: "Europe/Istanbul",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).format(d);
  return `${day}, ${time(start)}–${time(end)}`;
}

/**
 * What the exhibitor has lined up so far, across rooms.
 *
 * Comparing rooms means leaving the page you were configuring, and until now
 * there was nowhere to see what you had already priced up. Nothing here is a
 * booking — no slot is held — so it says so plainly rather than looking like a
 * basket that has reserved something.
 */
export default function SavedSelections(): JSX.Element | null {
  // Read after mount: sessionStorage does not exist while this renders on the
  // server, and reading it during render would desync hydration.
  const [selections, setSelections] = useState<RoomSelection[] | null>(null);
  const pay = trpc.viewer.rooms.createOrder.useMutation({
    onSuccess: (data) => {
      if (data.checkoutUrl) window.location.href = data.checkoutUrl;
    },
  });
  useEffect(() => {
    setSelections(listSelections());
  }, []);

  if (!selections?.length) return null;

  const total = selections.reduce((sum, s) => sum + s.total, 0);
  const currency = selections[0].currency;
  const sameCurrency = selections.every((s) => s.currency === currency);

  function forget(slug: string): void {
    clearSelection(slug);
    setSelections(listSelections());
  }

  // Everything payable in one go. A shortlist entry with no time picked is not
  // a booking yet, so it stays on the list rather than blocking the others.
  const payable = (selections ?? []).filter((s) => s.startUtc);
  const canPay = payable.length > 0 && sameCurrency;

  return (
    <section className="mt-6 rounded-xl border border-[#000643]/15 bg-[#000643]/[0.03] p-4">
      <h2 className="font-semibold text-[#000643] text-sm uppercase tracking-wide">Your shortlist</h2>
      <p className="mt-1 text-gray-600 text-xs">
        Rooms you have configured but not booked. Nothing is held until you pay. Amounts exclude VAT,
        which is determined at checkout from your billing country and VAT number.
      </p>

      <ul className="mt-3 divide-y divide-[#000643]/10">
        {selections.map((selection) => (
          <li key={selection.slug} className="flex items-center justify-between gap-3 py-2">
            <Link href={`/rooms/${selection.slug}`} className="min-w-0 flex-1 group">
              <span className="block truncate font-medium text-[#000643] text-sm group-hover:underline">
                {selection.roomName}
              </span>
              <span className="block truncate text-gray-500 text-xs">{formatSlot(selection)}</span>
            </Link>
            <span className="shrink-0 font-medium text-[#000643] text-sm">
              {formatPrice(selection.total, selection.currency)}
            </span>
            <button
              type="button"
              onClick={() => forget(selection.slug)}
              aria-label={`Remove ${selection.roomName} from your shortlist`}
              className="shrink-0 rounded-md p-1.5 text-gray-400 transition hover:bg-white hover:text-[#000643]">
              <Trash2 className="h-4 w-4" aria-hidden />
            </button>
          </li>
        ))}
      </ul>

      {selections.length > 1 && sameCurrency ? (
        <div className="mt-3 flex items-center justify-between border-[#000643]/10 border-t pt-3 text-sm">
          <span className="text-gray-600">Total excl. VAT</span>
          <span className="font-semibold text-[#000643]">{formatPrice(total, currency)}</span>
        </div>
      ) : null}

      {canPay ? (
        <>
          <button
            type="button"
            disabled={pay.isPending}
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
            className="mt-4 flex w-full items-center justify-center gap-2 rounded-lg bg-[#000643] px-4 py-3 font-semibold text-sm text-white transition hover:opacity-90 disabled:opacity-40">
            <CreditCard className="h-4 w-4 shrink-0" aria-hidden />
            {pay.isPending
              ? "Holding the rooms…"
              : payable.length === 1
                ? "Pay for this room"
                : `Pay for all ${payable.length} rooms`}
          </button>
          <p className="mt-2 text-center text-gray-400 text-xs">
            One payment, one invoice. Nothing is held until you reach the payment page.
          </p>
          {pay.error ? (
            <p className="mt-2 rounded-lg bg-red-50 px-3 py-2 text-red-700 text-sm">{pay.error.message}</p>
          ) : null}
        </>
      ) : null}
    </section>
  );
}
