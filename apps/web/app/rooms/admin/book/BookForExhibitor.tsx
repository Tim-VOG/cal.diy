"use client";

import type { EventDayDefinition } from "@calcom/features/ne26-rooms/lib/eventSchedule";
import { buildEventSchedule, EVENT_TIME_ZONE } from "@calcom/features/ne26-rooms/lib/eventSchedule";
import { trpc } from "@calcom/trpc/react";
import { CalendarPlus } from "lucide-react";
import { useMemo, useState } from "react";

const TZ = EVENT_TIME_ZONE;

interface RoomOption {
  slug: string;
  name: string;
  price1h: number;
  price2h: number;
  price3h: number;
  currency: string;
}

function fmtDateTime(iso: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: TZ,
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(iso));
}

function money(cents: number, currency: string): string {
  return new Intl.NumberFormat("en-GB", { style: "currency", currency }).format(cents / 100);
}

function buildStartOptions(
  granularityMinutes: number,
  eventDays: EventDayDefinition[]
): { iso: string; label: string }[] {
  const stepMs = Math.max(15, granularityMinutes) * 60 * 1000;
  return buildEventSchedule(eventDays).flatMap((day) => {
    const dayOpenMs = day.openSlotStartsUtc[0]?.getTime() ?? 0;
    return day.openSlotStartsUtc
      .filter((d) => (d.getTime() - dayOpenMs) % stepMs === 0)
      .map((d) => ({ iso: d.toISOString(), label: fmtDateTime(d.toISOString()) }));
  });
}

const field =
  "mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-[#000643] focus:outline-none";

/**
 * Book a room for an exhibitor who asked for it, and email them the link.
 *
 * The welcome desk sells to whoever is standing at the counter and takes the
 * card there. This is the other half of the same job: a request that arrives
 * by phone or by mail, with nobody at a screen. So the room is put aside FIRM
 * — no countdown, nothing releases it for want of payment, because they asked
 * for it and owe it — and the payment link goes out by email.
 *
 * The price is shown before the button is pressed. An admin on the phone is
 * asked "how much?" before they are asked to confirm, and the counter screen
 * had to learn the same lesson.
 */
export default function BookForExhibitor({
  rooms,
  granularityMinutes,
  eventDays,
}: {
  rooms: RoomOption[];
  granularityMinutes: number;
  eventDays: EventDayDefinition[];
}): JSX.Element {
  const startOptions = useMemo(
    () => buildStartOptions(granularityMinutes, eventDays),
    [granularityMinutes, eventDays]
  );

  const [slug, setSlug] = useState(rooms[0]?.slug ?? "");
  const [startUtc, setStartUtc] = useState(startOptions[0]?.iso ?? "");
  const [durationHours, setDurationHours] = useState<1 | 2 | 3>(1);
  const [exhibitorName, setExhibitorName] = useState("");
  const [exhibitorEmail, setExhibitorEmail] = useState("");
  const [country, setCountry] = useState("");
  const [vatNumber, setVatNumber] = useState("");
  const [poNumber, setPoNumber] = useState("");

  const create = trpc.viewer.rooms.adminCreateBooking.useMutation();

  const room = rooms.find((r) => r.slug === slug);
  const priceExclVat = room
    ? { 1: room.price1h, 2: room.price2h, 3: room.price3h }[durationHours]
    : null;

  const ready =
    Boolean(slug && startUtc && exhibitorName.trim() && exhibitorEmail.trim() && country.trim()) &&
    country.trim().length === 2;

  return (
    <div className="mx-auto max-w-3xl">
      <h1 className="font-bold text-2xl text-[#000643]">Book for an exhibitor</h1>
      <p className="mt-1 text-gray-600 text-sm">
        For a request that came in by phone or email. The room is put aside firmly — no countdown, nothing
        releases it — and the payment link is emailed to them. Only do this at their express request: they
        owe the room whether or not they turn up.
      </p>

      <section className="mt-5 rounded-xl border border-gray-200 bg-white p-5">
        <h2 className="flex items-center gap-2 font-semibold text-[#000643] text-base">
          <CalendarPlus className="h-4 w-4 shrink-0" aria-hidden />
          The room
        </h2>
        <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
          <label className="text-sm">
            <span className="font-medium text-gray-700">Room</span>
            <select className={field} value={slug} onChange={(e) => setSlug(e.target.value)}>
              {rooms.map((r) => (
                <option key={r.slug} value={r.slug}>
                  {r.name}
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm">
            <span className="font-medium text-gray-700">Start (Istanbul)</span>
            <select className={field} value={startUtc} onChange={(e) => setStartUtc(e.target.value)}>
              {startOptions.map((o) => (
                <option key={o.iso} value={o.iso}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm">
            <span className="font-medium text-gray-700">Length</span>
            <select
              className={field}
              value={durationHours}
              onChange={(e) => setDurationHours(Number(e.target.value) as 1 | 2 | 3)}>
              <option value={1}>1 hour</option>
              <option value={2}>2 hours</option>
              <option value={3}>3 hours</option>
            </select>
          </label>
        </div>
        {priceExclVat !== null && room ? (
          <p className="mt-3 text-gray-700 text-sm">
            <strong className="tabular-nums">{money(priceExclVat, room.currency)}</strong> excl. VAT. The VAT
            is worked out from the country below and appears on the payment page.
          </p>
        ) : null}
      </section>

      <section className="mt-4 rounded-xl border border-gray-200 bg-white p-5">
        <h2 className="font-semibold text-[#000643] text-base">The exhibitor</h2>
        <p className="mt-1 text-gray-500 text-xs">
          No account needed. The postal address for the invoice is collected on the payment page; the country
          is asked here because it decides the VAT rate.
        </p>
        <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
          <label className="text-sm">
            <span className="font-medium text-gray-700">Name</span>
            <input
              className={field}
              value={exhibitorName}
              maxLength={120}
              onChange={(e) => setExhibitorName(e.target.value)}
            />
          </label>
          <label className="text-sm">
            <span className="font-medium text-gray-700">Email</span>
            <input
              className={field}
              type="email"
              value={exhibitorEmail}
              onChange={(e) => setExhibitorEmail(e.target.value)}
            />
          </label>
          <label className="text-sm">
            <span className="font-medium text-gray-700">Country (2 letters)</span>
            <input
              className={field}
              value={country}
              maxLength={2}
              placeholder="BE"
              onChange={(e) => setCountry(e.target.value.toUpperCase())}
            />
          </label>
          <label className="text-sm">
            <span className="font-medium text-gray-700">VAT number (optional)</span>
            <input className={field} value={vatNumber} maxLength={40} onChange={(e) => setVatNumber(e.target.value)} />
          </label>
          <label className="text-sm sm:col-span-2">
            <span className="font-medium text-gray-700">Purchase order (optional)</span>
            <input className={field} value={poNumber} maxLength={60} onChange={(e) => setPoNumber(e.target.value)} />
          </label>
        </div>

        <button
          type="button"
          disabled={create.isPending || !ready}
          onClick={() =>
            create.mutate({
              slug,
              startUtc,
              durationHours,
              exhibitorName: exhibitorName.trim(),
              exhibitorEmail: exhibitorEmail.trim(),
              country: country.trim(),
              vatNumber: vatNumber.trim() || undefined,
              poNumber: poNumber.trim() || undefined,
            })
          }
          className="mt-4 rounded-lg bg-[#000643] px-4 py-2 font-semibold text-sm text-white transition hover:opacity-90 disabled:opacity-40">
          {create.isPending ? "Booking…" : "Book it and email the link"}
        </button>

        {create.error ? <p className="mt-3 text-red-600 text-sm">{create.error.message}</p> : null}

        {create.data ? (
          <div className="mt-4 rounded-lg bg-gray-50 px-4 py-3 text-sm">
            <p className="font-semibold text-[#000643]">
              {create.data.roomName} · {create.data.slotLabel}
            </p>
            <p className="mt-1 text-gray-600">
              {create.data.amountLabel} excl. VAT. The room is theirs — no deadline, nothing releases it.
            </p>
            <p className="mt-2 text-gray-600">
              {create.data.emailed ? (
                <>
                  Payment link sent to <strong>{create.data.exhibitorEmail}</strong>.
                </>
              ) : (
                <span className="text-amber-700">
                  The email could not be sent. Pass this link on instead — the booking itself is fine.
                </span>
              )}
            </p>
            <a
              href={create.data.checkoutUrl}
              target="_blank"
              rel="noreferrer"
              className="mt-1 block break-all text-[#000643] text-xs underline hover:opacity-80">
              {create.data.checkoutUrl}
            </a>
          </div>
        ) : null}
      </section>
    </div>
  );
}
