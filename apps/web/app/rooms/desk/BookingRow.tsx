"use client";

import { Check, Clock, Undo2, UserCheck } from "lucide-react";

export interface DeskBooking {
  uid: string;
  startTime: string | Date;
  endTime: string | Date;
  durationMinutes: number;
  bookerName: string;
  bookerEmail: string;
  checkedInAt: string | Date | null;
  checkedInByEmail: string | null;
  resource: { name: string; slug: string; category: string };
  addOns: { quantity: number; addOn: { name: string } }[];
}

function time(value: string | Date): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Brussels",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(value));
}

function day(value: string | Date): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Brussels",
    weekday: "short",
    day: "numeric",
    month: "short",
  }).format(new Date(value));
}

/**
 * One booking as the desk sees it. No prices anywhere: the hostess greets people
 * and points them at a room, and what someone paid is not her business — nor
 * anything she should be able to read out loud at a busy counter.
 */
export default function BookingRow({
  booking,
  showDay,
  onToggle,
  busy,
}: {
  booking: DeskBooking;
  showDay?: boolean;
  onToggle: (uid: string, arrived: boolean) => void;
  busy?: boolean;
}): JSX.Element {
  const arrived = Boolean(booking.checkedInAt);

  return (
    <li
      className={`flex flex-wrap items-center gap-3 rounded-xl border px-4 py-3 transition ${
        arrived ? "border-green-200 bg-green-50/60" : "border-gray-200 bg-white"
      }`}>
      <div className="flex w-24 shrink-0 flex-col">
        <span className="flex items-center gap-1.5 font-semibold text-[#000643]">
          <Clock className="h-4 w-4 shrink-0" aria-hidden />
          {time(booking.startTime)}
        </span>
        <span className="text-gray-500 text-xs">
          {showDay ? `${day(booking.startTime)} · ` : ""}
          {booking.durationMinutes / 60}h
        </span>
      </div>

      <div className="min-w-0 flex-1">
        <span className="block truncate font-medium text-[#000643]">{booking.bookerName}</span>
        <span className="block truncate text-gray-500 text-sm">{booking.resource.name}</span>
        {booking.addOns.length ? (
          <span className="mt-0.5 block truncate text-gray-400 text-xs">
            {booking.addOns
              .map((a) => (a.quantity > 1 ? `${a.addOn.name} x${a.quantity}` : a.addOn.name))
              .join(" · ")}
          </span>
        ) : null}
      </div>

      {arrived ? (
        <div className="flex items-center gap-2">
          <span className="flex items-center gap-1.5 rounded-full bg-green-100 px-3 py-1.5 font-medium text-green-800 text-sm">
            <Check className="h-4 w-4 shrink-0" aria-hidden />
            Arrived {time(booking.checkedInAt as string)}
          </span>
          <button
            type="button"
            disabled={busy}
            onClick={() => onToggle(booking.uid, false)}
            aria-label={`Undo check-in for ${booking.bookerName}`}
            className="rounded-lg p-2 text-gray-400 transition hover:bg-white hover:text-[#000643] disabled:opacity-50">
            <Undo2 className="h-4 w-4" aria-hidden />
          </button>
        </div>
      ) : (
        <button
          type="button"
          disabled={busy}
          onClick={() => onToggle(booking.uid, true)}
          // Big enough to hit on a tablet without looking, which is how it will
          // actually be used.
          className="inline-flex items-center gap-2 rounded-lg bg-[#000643] px-4 py-2.5 font-medium text-sm text-white transition hover:bg-[#000643]/90 disabled:opacity-50">
          <UserCheck className="h-4 w-4 shrink-0" aria-hidden />
          Check in
        </button>
      )}
    </li>
  );
}
