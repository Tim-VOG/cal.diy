"use client";

import { brusselsToday, shiftDay } from "@calcom/features/ne26-rooms/lib/deskDay";
import { trpc } from "@calcom/trpc/react";
import { Check, ChevronLeft, ChevronRight } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { useState } from "react";
import BookingRow, { type DeskBooking } from "./BookingRow";

function label(date: string): string {
  const [y, m, d] = date.split("-").map(Number);
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "UTC",
    weekday: "long",
    day: "numeric",
    month: "long",
  }).format(new Date(Date.UTC(y, m - 1, d)));
}

export default function DayView(): JSX.Element {
  // Stripe sends a counter sale back here rather than to the public confirmation
  // page, so the hostess stays in the counter shell with the next exhibitor
  // already waiting. The banner is the only thing telling her it went through.
  const paid = useSearchParams()?.get("paid");
  // Opens on the event's first day until the event is actually running, rather
  // than on a today that is months away from any booking.
  const eventDays = trpc.viewer.rooms.deskEventDays.useQuery();
  const [chosen, setChosen] = useState<string | null>(null);
  const date = chosen ?? eventDays.data?.defaultDate ?? brusselsToday();
  const setDate = (next: string | ((d: string) => string)) =>
    setChosen((current) => {
      const from = current ?? eventDays.data?.defaultDate ?? brusselsToday();
      return typeof next === "function" ? next(from) : next;
    });
  const bookings = trpc.viewer.rooms.deskDay.useQuery({ date });
  const checkIn = trpc.viewer.rooms.deskCheckIn.useMutation({
    onSuccess: () => void bookings.refetch(),
  });

  const rows = (bookings.data ?? []) as unknown as DeskBooking[];
  const arrived = rows.filter((r) => r.checkedInAt).length;
  // Before the event, "Today" would land on an empty August day. Send them back
  // to the event instead — that is what they meant.
  const home = eventDays.data?.defaultDate ?? brusselsToday();
  const atHome = date === home;

  return (
    <div>
      {paid ? (
        <div className="mb-4 flex items-start gap-3 rounded-xl border border-green-200 bg-green-50 px-4 py-3">
          <Check className="mt-0.5 h-5 w-5 shrink-0 text-green-700" aria-hidden />
          <p className="text-green-900 text-sm">
            Payment received — the room is confirmed and the invoice is on its way to the exhibitor.
          </p>
        </div>
      ) : null}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => setDate((d) => shiftDay(d, -1))}
            aria-label="Previous day"
            className="rounded-lg border border-gray-200 bg-white p-2.5 text-[#000643] transition hover:border-[#000643]">
            <ChevronLeft className="h-5 w-5" aria-hidden />
          </button>
          <button
            type="button"
            onClick={() => setDate((d) => shiftDay(d, 1))}
            aria-label="Next day"
            className="rounded-lg border border-gray-200 bg-white p-2.5 text-[#000643] transition hover:border-[#000643]">
            <ChevronRight className="h-5 w-5" aria-hidden />
          </button>
          {!atHome ? (
            <button
              type="button"
              onClick={() => setDate(home)}
              className="ml-1 rounded-lg border border-gray-200 bg-white px-3 py-2 font-medium text-[#000643] text-sm transition hover:border-[#000643]">
              {home === brusselsToday() ? "Today" : "Back to the event"}
            </button>
          ) : null}
        </div>
        <span className="text-gray-500 text-sm">
          {rows.length ? `${arrived} of ${rows.length} arrived` : ""}
        </span>
      </div>

      <h1 className="mt-4 font-bold text-2xl text-[#000643]">{label(date)}</h1>
      <p className="mt-1 text-gray-600 text-sm">
        Paid bookings only. A room someone has reserved but not paid for is not an arrival, so it does not
        appear here.
      </p>

      {bookings.isPending ? (
        <p className="mt-6 text-gray-500 text-sm">Loading…</p>
      ) : rows.length ? (
        <ul className="mt-5 space-y-2">
          {rows.map((booking) => (
            <BookingRow
              key={booking.uid}
              booking={booking}
              busy={checkIn.isPending}
              onToggle={(uid, isArrived) => checkIn.mutate({ uid, arrived: isArrived })}
            />
          ))}
        </ul>
      ) : (
        <p className="mt-6 rounded-xl border border-gray-200 bg-white px-4 py-8 text-center text-gray-500 text-sm">
          Nothing booked on this day.
        </p>
      )}

      {checkIn.error ? (
        <p className="mt-4 rounded-lg bg-red-50 px-3 py-2 text-red-700 text-sm">{checkIn.error.message}</p>
      ) : null}
    </div>
  );
}
