"use client";

import { trpc } from "@calcom/trpc/react";
import { ExternalLink, Info } from "lucide-react";
import { useMemo, useState } from "react";

const inputClass =
  "mt-1 w-full rounded-lg border border-gray-200 px-4 py-3 text-base focus:border-[#000643] focus:outline-none";

type Duration = 1 | 2 | 3;

function time(iso: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Brussels",
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

export default function NewBookingView(): JSX.Element {
  const availability = trpc.viewer.rooms.deskAvailability.useQuery();
  const [email, setEmail] = useState("");
  const [slug, setSlug] = useState("");
  const [date, setDate] = useState("");
  const [startUtc, setStartUtc] = useState("");
  const [duration, setDuration] = useState<Duration>(1);
  const [addOns, setAddOns] = useState<Record<string, number>>({});

  const create = trpc.viewer.rooms.deskCreateBooking.useMutation();

  const rooms = availability.data?.rooms ?? [];
  const catalogue = availability.data?.addOns ?? [];
  const room = useMemo(() => rooms.find((r) => r.room.slug === slug), [rooms, slug]);
  const days = room?.days ?? [];
  const day = days.find((d) => d.date === date);

  // Only starts that can actually fit the chosen duration — the same rule the
  // public page applies, so the desk cannot create something a buyer could not.
  const starts = (day?.starts ?? []).filter((s) => s.availableDurations.includes(duration));

  function reset(): void {
    setEmail("");
    setSlug("");
    setDate("");
    setStartUtc("");
    setDuration(1);
    setAddOns({});
    create.reset();
  }

  if (create.data) {
    return (
      <div className="mx-auto max-w-lg text-center">
        <h1 className="font-bold text-2xl text-[#000643]">Room held — awaiting payment</h1>
        <p className="mt-2 text-gray-600 text-sm">
          The room is reserved for {email} for the next 35 minutes. It is only theirs once the payment
          goes through.
        </p>

        <a
          href={create.data.checkoutUrl}
          className="mt-6 inline-flex w-full items-center justify-center gap-2 rounded-lg bg-[#000643] px-5 py-4 font-medium text-base text-white transition hover:bg-[#000643]/90">
          <ExternalLink className="h-5 w-5 shrink-0" aria-hidden />
          Open the payment page
        </a>

        <div className="mt-5 flex items-start gap-3 rounded-lg border border-gray-200 bg-white px-4 py-3 text-left">
          <Info className="mt-0.5 h-5 w-5 shrink-0 text-[#000643]" aria-hidden />
          <p className="text-gray-600 text-sm">
            They can also pay from their own phone: it is waiting under{" "}
            <span className="font-medium text-[#000643]">My bookings</span> in their account. If nobody
            pays within 35 minutes the room goes back on sale on its own.
          </p>
        </div>

        <button
          type="button"
          onClick={reset}
          className="mt-6 rounded-lg border border-gray-200 px-5 py-3 font-medium text-[#000643] text-sm transition hover:border-[#000643]">
          Start another booking
        </button>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-lg">
      <h1 className="font-bold text-2xl text-[#000643]">New booking</h1>
      <p className="mt-1 text-gray-600 text-sm">
        For someone at the counter. They need an account with their billing details already filled in —
        those go on the invoice, so they cannot be entered here.
      </p>

      <form
        className="mt-5 space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          create.mutate({
            exhibitorEmail: email,
            slug,
            startUtc,
            durationHours: duration,
            addOns: Object.entries(addOns)
              .filter(([, q]) => q > 0)
              .map(([s, quantity]) => ({ slug: s, quantity })),
          });
        }}>
        <label className="block">
          <span className="font-medium text-gray-700 text-sm">Exhibitor email</span>
          <input
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="them@company.com"
            className={inputClass}
          />
        </label>

        <label className="block">
          <span className="font-medium text-gray-700 text-sm">Room</span>
          <select
            required
            value={slug}
            onChange={(e) => {
              setSlug(e.target.value);
              setDate("");
              setStartUtc("");
            }}
            className={inputClass}>
            <option value="">Choose a room…</option>
            {rooms.map((r) => (
              <option key={r.room.slug} value={r.room.slug}>
                {r.room.name} — {r.room.capacity} people
              </option>
            ))}
          </select>
        </label>

        <div>
          <span className="font-medium text-gray-700 text-sm">Duration</span>
          <div className="mt-1 flex gap-2">
            {([1, 2, 3] as Duration[]).map((d) => (
              <button
                key={d}
                type="button"
                onClick={() => {
                  setDuration(d);
                  setStartUtc("");
                }}
                className={`flex-1 rounded-lg border px-4 py-3 font-medium text-sm transition ${
                  duration === d
                    ? "border-[#000643] bg-[#000643] text-white"
                    : "border-gray-200 bg-white text-[#000643] hover:border-[#000643]"
                }`}>
                {d}h
              </button>
            ))}
          </div>
        </div>

        <label className="block">
          <span className="font-medium text-gray-700 text-sm">Day</span>
          <select
            required
            disabled={!room}
            value={date}
            onChange={(e) => {
              setDate(e.target.value);
              setStartUtc("");
            }}
            className={inputClass}>
            <option value="">Choose a day…</option>
            {days.map((d) => (
              <option key={d.date} value={d.date}>
                {dayLabel(d.date)}
              </option>
            ))}
          </select>
        </label>

        <label className="block">
          <span className="font-medium text-gray-700 text-sm">Start time</span>
          <select
            required
            disabled={!day}
            value={startUtc}
            onChange={(e) => setStartUtc(e.target.value)}
            className={inputClass}>
            <option value="">Choose a time…</option>
            {starts.map((s) => (
              <option key={s.startUtc} value={s.startUtc}>
                {time(s.startUtc)}
              </option>
            ))}
          </select>
          {day && !starts.length ? (
            <span className="mt-1 block text-amber-700 text-xs">
              Nothing free for {duration}h on this day. Try a shorter booking or another day.
            </span>
          ) : null}
        </label>

        {catalogue.length ? (
          <fieldset>
            <legend className="font-medium text-gray-700 text-sm">Add-ons</legend>
            <div className="mt-2 space-y-2">
              {catalogue.map((addOn) => (
                <label
                  key={addOn.slug}
                  className="flex items-center gap-3 rounded-lg border border-gray-200 bg-white px-3 py-2.5">
                  <input
                    type="checkbox"
                    checked={Boolean(addOns[addOn.slug])}
                    onChange={(e) =>
                      setAddOns((prev) => {
                        const next = { ...prev };
                        if (e.target.checked) next[addOn.slug] = 1;
                        else delete next[addOn.slug];
                        return next;
                      })
                    }
                    className="h-5 w-5"
                  />
                  <span className="min-w-0 flex-1 text-sm">{addOn.name}</span>
                  {addOns[addOn.slug] ? (
                    <input
                      type="number"
                      min={1}
                      value={addOns[addOn.slug]}
                      onChange={(e) =>
                        setAddOns((prev) => ({
                          ...prev,
                          [addOn.slug]: Math.max(1, Number(e.target.value) || 1),
                        }))
                      }
                      aria-label={`Quantity for ${addOn.name}`}
                      className="w-20 rounded-lg border border-gray-200 px-2 py-1.5 text-sm"
                    />
                  ) : null}
                </label>
              ))}
            </div>
          </fieldset>
        ) : null}

        {create.error ? (
          <p className="rounded-lg bg-red-50 px-3 py-2 text-red-700 text-sm">{create.error.message}</p>
        ) : null}

        <button
          type="submit"
          disabled={create.isPending || !startUtc}
          className="w-full rounded-lg bg-[#000643] px-5 py-4 font-medium text-base text-white transition hover:bg-[#000643]/90 disabled:opacity-50">
          {create.isPending ? "Holding the room…" : "Hold the room and go to payment"}
        </button>
      </form>
    </div>
  );
}
