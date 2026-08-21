"use client";

import { trpc } from "@calcom/trpc/react";
import { Search } from "lucide-react";
import { useState } from "react";
import BookingRow, { type DeskBooking } from "../BookingRow";

export default function SearchView(): JSX.Element {
  const [term, setTerm] = useState("");
  // Only sent on submit: a query-as-you-type across the whole event would hit
  // the database on every keystroke at the busiest moment of the day.
  const [submitted, setSubmitted] = useState("");

  const results = trpc.viewer.rooms.deskSearch.useQuery(
    { query: submitted },
    { enabled: submitted.length >= 2 }
  );
  const checkIn = trpc.viewer.rooms.deskCheckIn.useMutation({
    onSuccess: () => void results.refetch(),
  });

  const rows = (results.data ?? []) as unknown as DeskBooking[];

  return (
    <div>
      <h1 className="font-bold text-2xl text-[#000643]">Find a booking</h1>
      <p className="mt-1 text-gray-600 text-sm">
        Search the whole event by name or email — for when someone knows they booked but not when.
      </p>

      <form
        className="mt-4 flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          setSubmitted(term.trim());
        }}>
        <input
          type="search"
          value={term}
          onChange={(e) => setTerm(e.target.value)}
          placeholder="Name or email"
          aria-label="Name or email"
          className="min-w-0 flex-1 rounded-lg border border-gray-200 px-4 py-3 text-base focus:border-[#000643] focus:outline-none"
        />
        <button
          type="submit"
          disabled={term.trim().length < 2}
          className="inline-flex items-center gap-2 rounded-lg bg-[#000643] px-5 py-3 font-medium text-sm text-white transition hover:bg-[#000643]/90 disabled:opacity-50">
          <Search className="h-4 w-4 shrink-0" aria-hidden />
          Search
        </button>
      </form>

      {results.isPending && submitted.length >= 2 ? (
        <p className="mt-6 text-gray-500 text-sm">Searching…</p>
      ) : null}

      {submitted.length >= 2 && !results.isPending ? (
        rows.length ? (
          <ul className="mt-5 space-y-2">
            {rows.map((booking) => (
              <BookingRow
                key={booking.uid}
                booking={booking}
                showDay
                busy={checkIn.isPending}
                onToggle={(uid, arrived) => checkIn.mutate({ uid, arrived })}
              />
            ))}
          </ul>
        ) : (
          <p className="mt-6 rounded-xl border border-gray-200 bg-white px-4 py-8 text-center text-gray-500 text-sm">
            Nothing found for “{submitted}”. Only paid bookings appear here.
          </p>
        )
      ) : null}

      {checkIn.error ? (
        <p className="mt-4 rounded-lg bg-red-50 px-3 py-2 text-red-700 text-sm">{checkIn.error.message}</p>
      ) : null}
    </div>
  );
}
