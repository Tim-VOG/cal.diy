"use client";

import { brusselsToday, shiftDay } from "@calcom/features/ne26-rooms/lib/deskDay";
import { trpc } from "@calcom/trpc/react";
import { ChevronLeft, ChevronRight } from "lucide-react";
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
  const [date, setDate] = useState(() => brusselsToday());
  const bookings = trpc.viewer.rooms.deskDay.useQuery({ date });
  const checkIn = trpc.viewer.rooms.deskCheckIn.useMutation({
    onSuccess: () => void bookings.refetch(),
  });

  const rows = (bookings.data ?? []) as unknown as DeskBooking[];
  const arrived = rows.filter((r) => r.checkedInAt).length;
  const isToday = date === brusselsToday();

  return (
    <div>
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
          {!isToday ? (
            <button
              type="button"
              onClick={() => setDate(brusselsToday())}
              className="ml-1 rounded-lg border border-gray-200 bg-white px-3 py-2 font-medium text-[#000643] text-sm transition hover:border-[#000643]">
              Today
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
