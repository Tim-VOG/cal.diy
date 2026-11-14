"use client";

import { roomDoorName, roomSoldName } from "@calcom/features/ne26-rooms/lib/roomNames";
import { Check, Clock, CreditCard, Undo2, UserCheck } from "lucide-react";
import { useEffect, useState } from "react";

export interface DeskBooking {
  uid: string;
  startTime: string | Date;
  endTime: string | Date;
  durationMinutes: number;
  bookerName: string;
  bookerEmail: string;
  /** CONFIRMED, or PENDING for a hold that has not been paid for yet. */
  status: string;
  /** When an unpaid hold frees itself. */
  holdExpiresAt: string | Date | null;
  checkedInAt: string | Date | null;
  checkedInByEmail: string | null;
  /**
   * Still carried in the payload, read by nobody here: the desk shows nothing
   * about cancellation since an order became binding on payment. Left in place
   * so the admin keeps reading the same shape.
   */
  cancellationRequestedAt: string | Date | null;
  cancellationRequestedBy: string | null;
  /** The company on the order — how an exhibitor introduces themselves. */
  order: { bookerLegalName: string | null } | null;
  resource: { name: string; venueName: string | null; slug: string; category: string };
  addOns: { quantity: number; addOn: { name: string } }[];
}

function time(value: string | Date): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Istanbul",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(value));
}

function day(value: string | Date): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Istanbul",
    weekday: "short",
    day: "numeric",
    month: "short",
  }).format(new Date(value));
}

function iso(value: string | Date | null): string | null {
  return value ? new Date(value).toISOString() : null;
}

/**
 * One booking as the desk sees it. No prices anywhere: the hostess greets
 * people and points them at a room, and what someone paid is not her business —
 * nor anything she should be able to read out loud at a busy counter.
 *
 * A row is either a paid room, which can be checked in and given back, or a
 * live hold, which can only be paid for. The two are deliberately not the same
 * shape on screen: an exhibitor whose card was refused this morning is standing
 * here believing they have a room, and the row has to say otherwise before the
 * hostess does.
 */
export default function BookingRow({
  booking,
  showDay,
  onToggle,
  onResume,
  busy,
}: {
  booking: DeskBooking;
  showDay?: boolean;
  onToggle: (uid: string, arrived: boolean) => void;
  /** Reopens the payment page for an unpaid hold. */
  onResume?: (uid: string) => void;
  busy?: boolean;
}): JSX.Element {
  const arrived = Boolean(booking.checkedInAt);
  const held = booking.status === "PENDING";

  return (
    <li
      className={`flex flex-wrap items-center gap-3 rounded-xl border px-4 py-3 transition ${
        held
          ? "border-amber-300 bg-amber-50/70"
          : arrived
            ? "border-green-200 bg-green-50/60"
            : "border-gray-200 bg-white"
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
        <span className="block truncate font-medium text-[#000643]">
          {booking.bookerName}
          {booking.order?.bookerLegalName ? (
            // The badge says the company; the person says their name. The
            // hostess hears one and reads the other, so both are on the line.
            <span className="font-normal text-gray-500"> · {booking.order.bookerLegalName}</span>
          ) : null}
        </span>
        <span className="block truncate text-gray-500 text-sm">
          {/* The door first: pointing someone at a room is the whole job, and
              the door does not say what the room was sold as. */}
          {roomDoorName(booking.resource)}
          {roomSoldName(booking.resource) ? (
            <span className="text-gray-400"> · {roomSoldName(booking.resource)}</span>
          ) : null}
        </span>
        {held ? (
          <span className="mt-0.5 block font-medium text-[12px] text-amber-900">
            Not paid —{" "}
            {booking.holdExpiresAt ? (
              <TimeLeft iso={iso(booking.holdExpiresAt) as string} />
            ) : (
              "the room is not theirs yet"
            )}
          </span>
        ) : booking.addOns.length ? (
          <span className="mt-0.5 block truncate text-gray-400 text-xs">
            {booking.addOns
              .map((a) => (a.quantity > 1 ? `${a.addOn.name} x${a.quantity}` : a.addOn.name))
              .join(" · ")}
          </span>
        ) : null}
      </div>

      {held ? (
        <button
          type="button"
          disabled={busy}
          onClick={() => onResume?.(booking.uid)}
          className="inline-flex items-center gap-2 rounded-lg bg-[#000643] px-4 py-2.5 font-medium text-sm text-white transition hover:bg-[#000643]/90 disabled:opacity-50">
          <CreditCard className="h-4 w-4 shrink-0" aria-hidden />
          Take the payment
        </button>
      ) : arrived ? (
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

/** Minutes left on a hold, so the counter can see the clock it is racing. */
function TimeLeft({ iso: value }: { iso: string }): JSX.Element {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 15_000);
    return () => clearInterval(t);
  }, []);

  const msLeft = new Date(value).getTime() - now;
  if (msLeft <= 0) return <>the hold has run out</>;
  const minutes = Math.ceil(msLeft / 60_000);
  return <>{minutes === 1 ? "1 minute left to pay" : `${minutes} minutes left to pay`}</>;
}
