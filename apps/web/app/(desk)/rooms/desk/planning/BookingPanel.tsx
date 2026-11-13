"use client";

import { Check, Clock, CreditCard, DoorOpen, Mail, Send, Undo2, UserCheck, X } from "lucide-react";
import { useEffect, useState } from "react";
import CancelRequestButton from "../CancelRequestButton";

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
  /** When an unpaid hold frees itself, so the counter can see the clock. */
  holdExpiresAt: string | null;
  arrivedAt: string | null;
  arrivedBy: string | null;
  cancellationRequestedAt: string | null;
  cancellationRequestedBy: string | null;
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
 *
 * What it does with an unpaid hold instead is reopen its payment page, or mail
 * the link — the counter's only fallback for a refused card, and the only way
 * back to a sale whose one screen has been left. And what it does with a room
 * somebody wants to give back is take the message, never the decision.
 */
export default function BookingPanel({
  booking,
  onClose,
  onToggle,
  onResume,
  resuming,
  resumeError,
  emailedTo,
  busy,
  error,
  onRequested,
}: {
  booking: PanelBooking;
  onClose: () => void;
  onToggle: (uid: string, arrived: boolean) => void;
  /** Reopens the payment page for a hold, or mails the link. */
  onResume: (uid: string, email: boolean) => void;
  resuming: boolean;
  resumeError: string | null;
  /** Set once a link has been mailed, so the screen says so. */
  emailedTo: string | null;
  busy: boolean;
  error: string | null;
  onRequested: () => void;
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
            <div className="rounded-lg bg-amber-50 px-3 py-3">
              <p className="text-amber-900 text-sm">
                This room is held but not paid for. It only becomes an arrival once the payment goes through.
              </p>
              {booking.holdExpiresAt ? (
                <p className="mt-1 font-medium text-amber-900 text-sm tabular-nums">
                  <TimeLeft iso={booking.holdExpiresAt} />
                </p>
              ) : null}

              {emailedTo ? (
                <p className="mt-3 flex items-start gap-1.5 text-amber-900 text-sm">
                  <Check className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
                  Link sent to {emailedTo}. The room stays held until the clock runs out.
                </p>
              ) : (
                <div className="mt-3 grid gap-2">
                  <button
                    type="button"
                    disabled={resuming}
                    onClick={() => onResume(booking.uid, false)}
                    className="inline-flex items-center justify-center gap-2 rounded-lg bg-[#000643] px-4 py-2.5 font-medium text-sm text-white transition hover:bg-[#000643]/90 disabled:opacity-50">
                    <CreditCard className="h-4 w-4 shrink-0" aria-hidden />
                    {resuming ? "Opening…" : "Open the payment page"}
                  </button>
                  <EmailLinkButton
                    email={booking.bookerEmail}
                    busy={resuming}
                    onSend={() => onResume(booking.uid, true)}
                  />
                </div>
              )}

              {resumeError ? (
                <p role="alert" className="mt-2 text-red-700 text-sm">
                  {resumeError}
                </p>
              ) : null}
            </div>
          ) : (
            <div className="border-gray-100 border-t pt-4">
              <p className="font-medium text-[11px] text-gray-400 uppercase tracking-wide">Wants to cancel</p>
              <div className="mt-2">
                <CancelRequestButton
                  uid={booking.uid}
                  roomLabel={booking.doorName}
                  requestedAt={booking.cancellationRequestedAt}
                  requestedBy={booking.cancellationRequestedBy}
                  onDone={onRequested}
                />
              </div>
            </div>
          )}

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

/**
 * How long an unpaid hold has left, counting down.
 *
 * A hold that frees itself at a time nobody can see is how a room gets sold
 * twice in one conversation: the hostess believes it is held, the clock runs
 * out mid-sentence, and the board shows it free to the next person asking.
 */
function TimeLeft({ iso }: { iso: string }): JSX.Element {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 15_000);
    return () => clearInterval(t);
  }, []);

  const msLeft = new Date(iso).getTime() - now;
  if (msLeft <= 0) return <>The hold has run out — the room is back on sale.</>;
  const minutes = Math.ceil(msLeft / 60_000);
  return <>{minutes === 1 ? "1 minute left to pay" : `${minutes} minutes left to pay`}</>;
}

/**
 * Mailing the payment link is the counter's fallback for a refused card. It
 * leaves the building, so it is asked twice.
 */
function EmailLinkButton({
  email,
  busy,
  onSend,
}: {
  email: string;
  busy: boolean;
  onSend: () => void;
}): JSX.Element {
  const [asking, setAsking] = useState(false);

  if (!asking) {
    return (
      <button
        type="button"
        disabled={busy}
        onClick={() => setAsking(true)}
        className="inline-flex items-center justify-center gap-2 rounded-lg border border-amber-300 bg-white px-4 py-2.5 font-medium text-amber-900 text-sm transition hover:border-amber-500 disabled:opacity-50">
        <Send className="h-4 w-4 shrink-0" aria-hidden />
        Email the link instead
      </button>
    );
  }

  return (
    <div className="rounded-lg border border-amber-300 bg-white p-3">
      <p className="break-all text-[#000643] text-sm">
        Send the payment link to <span className="font-medium">{email}</span>?
      </p>
      <div className="mt-2 flex gap-2">
        <button
          type="button"
          disabled={busy}
          onClick={onSend}
          className="flex-1 rounded-lg bg-[#000643] px-3 py-2 font-medium text-sm text-white transition hover:bg-[#000643]/90 disabled:opacity-50">
          {busy ? "Sending…" : "Yes, send it"}
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => setAsking(false)}
          className="flex-1 rounded-lg border border-gray-200 px-3 py-2 font-medium text-[#000643] text-sm transition hover:border-[#000643] disabled:opacity-50">
          Not now
        </button>
      </div>
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
