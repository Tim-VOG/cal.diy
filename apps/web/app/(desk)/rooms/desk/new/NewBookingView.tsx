"use client";

import { COUNTRY_OPTIONS } from "@calcom/features/ne26-rooms/lib/countries";
import { trpc } from "@calcom/trpc/react";
import { Check, ExternalLink, Info, Minus, Plus } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { useMemo, useState } from "react";

type Duration = 1 | 2 | 3;

const field =
  "mt-1 w-full rounded-lg border border-gray-200 px-4 py-3 text-base focus:border-[#000643] focus:outline-none";

function time(iso: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Istanbul",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(iso));
}

function dayLabel(date: string): string {
  const [y, m, d] = date.split("-").map(Number);
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "UTC",
    weekday: "short",
    day: "numeric",
    month: "short",
  }).format(new Date(Date.UTC(y, m - 1, d)));
}

/** A choice big enough to hit on a tablet without looking. */
function Choice({
  active,
  onClick,
  children,
  sub,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
  sub?: string;
}): JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-xl border px-4 py-3 text-left transition ${
        active
          ? "border-[#000643] bg-[#000643] text-white"
          : "border-gray-200 bg-white text-[#000643] hover:border-[#000643]"
      }`}>
      <span className="block font-medium text-sm">{children}</span>
      {sub ? (
        <span className={`block text-xs ${active ? "text-white/70" : "text-gray-500"}`}>{sub}</span>
      ) : null}
    </button>
  );
}

function Step({
  n,
  title,
  children,
}: {
  n: number;
  title: string;
  children: React.ReactNode;
}): JSX.Element {
  return (
    <section className="mt-6">
      <h2 className="flex items-center gap-2 font-semibold text-[#000643] text-sm uppercase tracking-wide">
        <span className="flex h-6 w-6 items-center justify-center rounded-full bg-[#000643] text-white text-xs">
          {n}
        </span>
        {title}
      </h2>
      <div className="mt-3">{children}</div>
    </section>
  );
}

export default function NewBookingView(): JSX.Element {
  const availability = trpc.viewer.rooms.deskAvailability.useQuery();
  const create = trpc.viewer.rooms.deskCreateBooking.useMutation();

  // Arriving from a click on the planning board: the room, day and time are
  // already decided, so the form opens at "who is booking" rather than making
  // the hostess re-pick what she just pointed at.
  const params = useSearchParams();
  const [date, setDate] = useState(() => params?.get("date") ?? "");
  const [slug, setSlug] = useState(() => params?.get("slug") ?? "");
  const [duration, setDuration] = useState<Duration>(1);
  const [startUtc, setStartUtc] = useState(() => params?.get("start") ?? "");
  const [addOns, setAddOns] = useState<Record<string, number>>({});
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [country, setCountry] = useState("");
  const [vatNumber, setVatNumber] = useState("");
  const [poNumber, setPoNumber] = useState("");
  const [internalReference, setInternalReference] = useState("");

  const rooms = availability.data?.rooms ?? [];
  const catalogue = availability.data?.addOns ?? [];

  // Every day the event runs, taken from the first room — they all share the
  // event calendar.
  const days = rooms[0]?.days ?? [];
  const room = useMemo(() => rooms.find((r) => r.room.slug === slug), [rooms, slug]);
  const day = room?.days.find((d) => d.date === date);
  const starts = (day?.starts ?? []).filter((s) => s.availableDurations.includes(duration));

  /** Other rooms with something free that day, when this one has nothing. */
  const alternatives = useMemo(() => {
    if (!date || !rooms.length) return [];
    return rooms
      .filter((r) => r.room.slug !== slug)
      .map((r) => ({
        room: r.room,
        starts: (r.days.find((d) => d.date === date)?.starts ?? []).filter((s) =>
          s.availableDurations.includes(duration)
        ),
      }))
      .filter((r) => r.starts.length > 0);
  }, [rooms, slug, date, duration]);

  /** Shorter stays in this same room, when the requested duration will not fit. */
  const shorterHere = useMemo(() => {
    if (!day) return [];
    return ([1, 2] as Duration[])
      .filter((d) => d < duration)
      .map((d) => ({ duration: d, count: day.starts.filter((s) => s.availableDurations.includes(d)).length }))
      .filter((o) => o.count > 0);
  }, [day, duration]);

  function reset(): void {
    setDate("");
    setSlug("");
    setDuration(1);
    setStartUtc("");
    setAddOns({});
    setName("");
    setEmail("");
    setCountry("");
    setVatNumber("");
    setPoNumber("");
    setInternalReference("");
    create.reset();
  }

  function bump(addOnSlug: string, by: number): void {
    setAddOns((prev) => {
      const next = { ...prev };
      const value = (next[addOnSlug] ?? 0) + by;
      if (value <= 0) delete next[addOnSlug];
      else next[addOnSlug] = value;
      return next;
    });
  }

  if (create.data) {
    return (
      <div className="mx-auto max-w-lg text-center">
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-green-100 text-green-700">
          <Check className="h-7 w-7" aria-hidden />
        </div>
        <h1 className="mt-4 font-bold text-2xl text-[#000643]">Room held — awaiting payment</h1>
        <p className="mt-2 text-gray-600 text-sm">
          Held for {name} for the next 35 minutes. It is only theirs once the payment goes through.
        </p>

        <a
          href={create.data.checkoutUrl}
          className="mt-6 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-[#000643] px-5 py-4 font-medium text-base text-white transition hover:bg-[#000643]/90">
          <ExternalLink className="h-5 w-5 shrink-0" aria-hidden />
          Open the payment page
        </a>

        <div className="mt-5 flex items-start gap-3 rounded-xl border border-gray-200 bg-white px-4 py-3 text-left">
          <Info className="mt-0.5 h-5 w-5 shrink-0 text-[#000643]" aria-hidden />
          <p className="text-gray-600 text-sm">
            They pay on this tablet, or hand it to them to type their own card. If nobody pays within 35
            minutes the room goes back on sale by itself.
          </p>
        </div>

        <button
          type="button"
          onClick={reset}
          className="mt-6 rounded-xl border border-gray-200 px-5 py-3 font-medium text-[#000643] text-sm">
          Start another booking
        </button>
      </div>
    );
  }

  const ready = Boolean(startUtc && name.trim() && email.trim() && country);

  return (
    <div className="mx-auto max-w-2xl pb-24">
      <h1 className="font-bold text-2xl text-[#000643]">New booking</h1>

      <Step n={1} title="Which day">
        <div className="grid grid-cols-3 gap-2">
          {days.map((d) => (
            <Choice
              key={d.date}
              active={date === d.date}
              onClick={() => {
                setDate(d.date);
                setStartUtc("");
              }}>
              {dayLabel(d.date)}
            </Choice>
          ))}
        </div>
      </Step>

      {date ? (
        <Step n={2} title="Which room">
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {rooms.map((r) => {
              const free = (r.days.find((d) => d.date === date)?.starts ?? []).filter((s) =>
                s.availableDurations.includes(duration)
              ).length;
              return (
                <Choice
                  key={r.room.slug}
                  active={slug === r.room.slug}
                  onClick={() => {
                    setSlug(r.room.slug);
                    setStartUtc("");
                  }}
                  sub={`${r.room.capacity} people · ${free} slot${free === 1 ? "" : "s"} free`}>
                  {r.room.name}
                </Choice>
              );
            })}
          </div>
        </Step>
      ) : null}

      {slug ? (
        <Step n={3} title="How long">
          <div className="grid grid-cols-3 gap-2">
            {([1, 2, 3] as Duration[]).map((d) => (
              <Choice
                key={d}
                active={duration === d}
                onClick={() => {
                  setDuration(d);
                  setStartUtc("");
                }}>
                {d}h
              </Choice>
            ))}
          </div>
        </Step>
      ) : null}

      {slug && date ? (
        <Step n={4} title="Which time">
          {starts.length ? (
            <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
              {starts.map((s) => (
                <Choice key={s.startUtc} active={startUtc === s.startUtc} onClick={() => setStartUtc(s.startUtc)}>
                  {time(s.startUtc)}
                </Choice>
              ))}
            </div>
          ) : (
            // Nothing free is where a counter sale is lost, so offer the way out
            // rather than a dead end: the same room for less time, or another
            // room at the length they asked for.
            <div className="rounded-xl border border-amber-200 bg-amber-50 p-4">
              <p className="font-medium text-amber-900 text-sm">
                Nothing free for {duration}h in {room?.room.name} on {dayLabel(date)}.
              </p>

              {shorterHere.length ? (
                <div className="mt-3">
                  <p className="text-amber-800 text-xs">Same room, shorter:</p>
                  <div className="mt-1.5 flex flex-wrap gap-2">
                    {shorterHere.map((o) => (
                      <button
                        key={o.duration}
                        type="button"
                        onClick={() => {
                          setDuration(o.duration);
                          setStartUtc("");
                        }}
                        className="rounded-lg border border-amber-300 bg-white px-3 py-2 font-medium text-[#000643] text-sm">
                        {o.duration}h — {o.count} free
                      </button>
                    ))}
                  </div>
                </div>
              ) : null}

              {alternatives.length ? (
                <div className="mt-3">
                  <p className="text-amber-800 text-xs">Other rooms, same day, {duration}h:</p>
                  <div className="mt-1.5 flex flex-wrap gap-2">
                    {alternatives.map((alt) => (
                      <button
                        key={alt.room.slug}
                        type="button"
                        onClick={() => {
                          setSlug(alt.room.slug);
                          setStartUtc("");
                        }}
                        className="rounded-lg border border-amber-300 bg-white px-3 py-2 font-medium text-[#000643] text-sm">
                        {alt.room.name} — {alt.starts.length} free
                      </button>
                    ))}
                  </div>
                </div>
              ) : null}

              {!shorterHere.length && !alternatives.length ? (
                <p className="mt-2 text-amber-800 text-sm">Nothing free anywhere that day at {duration}h.</p>
              ) : null}
            </div>
          )}
        </Step>
      ) : null}

      {startUtc && catalogue.length ? (
        <Step n={5} title="Add-ons">
          <div className="space-y-2">
            {catalogue.map((addOn) => {
              const quantity = addOns[addOn.slug] ?? 0;
              return (
                <div
                  key={addOn.slug}
                  className="flex items-center gap-3 rounded-xl border border-gray-200 bg-white px-4 py-3">
                  <span className="min-w-0 flex-1 text-sm">{addOn.name}</span>
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => bump(addOn.slug, -1)}
                      disabled={quantity === 0}
                      aria-label={`One fewer ${addOn.name}`}
                      className="flex h-11 w-11 items-center justify-center rounded-lg border border-gray-200 text-[#000643] disabled:opacity-30">
                      <Minus className="h-4 w-4" aria-hidden />
                    </button>
                    <span className="w-8 text-center font-semibold text-[#000643]">{quantity}</span>
                    <button
                      type="button"
                      onClick={() => bump(addOn.slug, 1)}
                      aria-label={`One more ${addOn.name}`}
                      className="flex h-11 w-11 items-center justify-center rounded-lg border border-gray-200 text-[#000643]">
                      <Plus className="h-4 w-4" aria-hidden />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </Step>
      ) : null}

      {startUtc ? (
        <Step n={6} title="Who is booking">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <label className="sm:col-span-2">
              <span className="font-medium text-gray-700 text-sm">Name</span>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                autoComplete="name"
                className={field}
              />
            </label>
            <label className="sm:col-span-2">
              <span className="font-medium text-gray-700 text-sm">Email</span>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="email"
                className={field}
              />
              <span className="mt-1 block text-gray-500 text-xs">The invoice goes here.</span>
            </label>
            <label>
              <span className="font-medium text-gray-700 text-sm">Billing country</span>
              <select value={country} onChange={(e) => setCountry(e.target.value)} className={field}>
                <option value="">Choose…</option>
                {COUNTRY_OPTIONS.map((c) => (
                  <option key={c.code} value={c.code}>
                    {c.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span className="font-medium text-gray-700 text-sm">
                VAT number <span className="text-gray-400">(optional)</span>
              </span>
              <input
                type="text"
                value={vatNumber}
                onChange={(e) => setVatNumber(e.target.value)}
                className={field}
              />
            </label>
            <label>
              <span className="font-medium text-gray-700 text-sm">
                PO number <span className="text-gray-400">(optional)</span>
              </span>
              <input
                type="text"
                value={poNumber}
                onChange={(e) => setPoNumber(e.target.value)}
                className={field}
              />
            </label>
            <label>
              <span className="font-medium text-gray-700 text-sm">
                Internal reference <span className="text-gray-400">(optional)</span>
              </span>
              <input
                type="text"
                value={internalReference}
                onChange={(e) => setInternalReference(e.target.value)}
                className={field}
              />
            </label>
          </div>
          <p className="mt-2 text-gray-500 text-xs">
            Country and VAT number decide the VAT charged, so they are needed before payment. The postal
            address is collected on the payment page and goes on the invoice.
          </p>
        </Step>
      ) : null}

      {create.error ? (
        <p className="mt-4 rounded-lg bg-red-50 px-3 py-2 text-red-700 text-sm">{create.error.message}</p>
      ) : null}

      {/* Pinned: on a tablet the form is longer than the screen, and the action
          should not be something you have to scroll to find. */}
      {startUtc ? (
        <div className="fixed inset-x-0 bottom-0 border-gray-200 border-t bg-white/95 p-3 backdrop-blur">
          <div className="mx-auto max-w-2xl">
            <button
              type="button"
              disabled={!ready || create.isPending}
              onClick={() =>
                create.mutate({
                  exhibitorEmail: email.trim(),
                  exhibitorName: name.trim(),
                  country,
                  vatNumber: vatNumber.trim() || undefined,
                  poNumber: poNumber.trim() || undefined,
                  internalReference: internalReference.trim() || undefined,
                  slug,
                  startUtc,
                  durationHours: duration,
                  addOns: Object.entries(addOns).map(([s, quantity]) => ({ slug: s, quantity })),
                })
              }
              className="w-full rounded-xl bg-[#000643] px-5 py-4 font-medium text-base text-white transition hover:bg-[#000643]/90 disabled:opacity-40">
              {create.isPending ? "Holding the room…" : "Hold the room and go to payment"}
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
