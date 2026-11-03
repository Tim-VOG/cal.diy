"use client";

import { Check, Clock, DoorOpen, Mail, Undo2, UserCheck, X } from "lucide-react";
import { useEffect } from "react";

export interface PanelBooking {
  uid: string;
  doorName: string;
  soldName: string | null;
  startUtc: string;
  endUtc: string;
  durationMinutes: number;
  bookerName: string;
  bookerEmail: string;
  company: string | null;
  addOns: { name: string; quantity: number }[];
  held: boolean;
  arrivedAt: string | null;
  arrivedBy: string | null;
}

function hhmm(iso: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Istanbul",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(iso));
}

function dayLabel(iso: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Istanbul",
    weekday: "long",
    day: "numeric",
    month: "long",
  }).format(new Date(iso));
}

/**
 * The order behind a block on the planning board.
 *
 * The board answers "who is in Meeting 3", and the next thing the hostess does
 * is greet them — so checking someone in used to mean leaving the board, going
 * to Today, and finding the row again. Opening the order where it was tapped
 * keeps her on the one screen that shows the whole day.
 *
 * Still no prices: the panel says what was bought, never what it cost. And
 * check-in stays shut on an unpaid hold, the same rule the server enforces, so
 * the button is simply absent rather than failing when pressed.
 */
export default function BookingPanel({
  booking,
  onClose,
  onToggle,
  busy,
  error,
}: {
  booking: PanelBooking;
  onClose: () => void;
  onToggle: (uid: string, arrived: boolean) => void;
  busy: boolean;
  error: string | null;
}): JSX.Element {
  // A tablet has no Escape key, but the admin works this board on a laptop.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const arrived = Boolean(booking.arrivedAt);

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <button
        type="button"
        aria-label="Close"
        tabIndex={-1}
        onClick={onClose}
        className="absolute inset-0 cursor-default bg-black/40"
      />
      <aside
        role="dialog"
        aria-modal="true"
        aria-label={`Booking for ${booking.company || booking.bookerName}`}
        className="relative flex h-full w-full max-w-sm flex-col bg-white shadow-xl">
        <div className="flex items-start justify-between gap-3 border-gray-100 border-b px-5 py-4">
          <div className="min-w-0">
            <h2 className="truncate font-bold text-[#000643] text-lg">
              {booking.company || booking.bookerName}
            </h2>
            {booking.company ? <p className="truncate text-gray-500 text-sm">{booking.bookerName}</p> : null}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="-mr-1 rounded-lg p-2 text-gray-400 transition hover:bg-gray-50 hover:text-[#000643]">
            <X className="h-5 w-5" aria-hidden />
          </button>
        </div>

        <div className="flex-1 space-y-4 overflow-y-auto px-5 py-5">
          <Line icon={DoorOpen} label="Room">
            <span className="font-semibold text-[#000643]">{booking.doorName}</span>
            {booking.soldName ? <span className="text-gray-500"> · booked as {booking.soldName}</span> : null}
          </Line>

          <Line icon={Clock} label="When">
            <span className="text-[#000643]">{dayLabel(booking.startUtc)}</span>
            <span className="block tabular-nums">
              {hhmm(booking.startUtc)}–{hhmm(booking.endUtc)} · {booking.durationMinutes / 60}h
            </span>
          </Line>

          <Line icon={Mail} label="Contact">
            <a href={`mailto:${booking.bookerEmail}`} className="break-all text-[#000643] underline">
              {booking.bookerEmail}
            </a>
          </Line>

          <div>
            <p className="font-medium text-[11px] text-gray-400 uppercase tracking-wide">Included</p>
            {booking.addOns.length ? (
              <ul className="mt-1.5 space-y-1">
                {booking.addOns.map((a) => (
                  <li key={a.name} className="flex items-center gap-2 text-[#000643] text-sm">
                    <Check className="h-4 w-4 shrink-0 text-gray-400" aria-hidden />
                    {a.name}
                    {a.quantity > 1 ? <span className="text-gray-500"> × {a.quantity}</span> : null}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-1 text-gray-500 text-sm">The room only — nothing else was ordered.</p>
            )}
          </div>

          {booking.held ? (
            <p className="rounded-lg bg-amber-50 px-3 py-2.5 text-amber-900 text-sm">
              This room is held but not paid for. It only becomes an arrival once the payment goes through.
            </p>
          ) : null}

          {error ? (
            <p role="alert" className="rounded-lg bg-red-50 px-3 py-2.5 text-red-700 text-sm">
              {error}
            </p>
          ) : null}
        </div>

        {booking.held ? null : (
          <div className="border-gray-100 border-t px-5 py-4">
            {arrived ? (
              <>
                <p className="flex items-center gap-2 font-medium text-green-800 text-sm">
                  <Check className="h-4 w-4 shrink-0" aria-hidden />
                  Arrived {hhmm(booking.arrivedAt as string)}
                  {booking.arrivedBy ? (
                    <span className="font-normal text-gray-500">· {booking.arrivedBy}</span>
                  ) : null}
                </p>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => onToggle(booking.uid, false)}
                  className="mt-3 inline-flex w-full items-center justify-center gap-2 rounded-lg border border-gray-200 px-4 py-3 font-medium text-[#000643] text-sm transition hover:border-[#000643] disabled:opacity-50">
                  <Undo2 className="h-4 w-4 shrink-0" aria-hidden />
                  Undo check-in
                </button>
              </>
            ) : (
              <button
                type="button"
                disabled={busy}
                onClick={() => onToggle(booking.uid, true)}
                className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-[#000643] px-4 py-3.5 font-medium text-base text-white transition hover:bg-[#000643]/90 disabled:opacity-50">
                <UserCheck className="h-5 w-5 shrink-0" aria-hidden />
                {busy ? "Checking in…" : "Check in"}
              </button>
            )}
          </div>
        )}
      </aside>
    </div>
  );
}

function Line({
  icon: Icon,
  label,
  children,
}: {
  icon: typeof Clock;
  label: string;
  children: React.ReactNode;
}): JSX.Element {
  return (
    <div className="flex gap-3">
      <Icon className="mt-0.5 h-4 w-4 shrink-0 text-gray-400" aria-hidden />
      <div className="min-w-0 text-gray-600 text-sm">
        <p className="font-medium text-[11px] text-gray-400 uppercase tracking-wide">{label}</p>
        <div className="mt-0.5">{children}</div>
      </div>
    </div>
  );
}
