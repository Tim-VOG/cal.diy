"use client";

import { trpc } from "@calcom/trpc/react";
import { Clock3 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

export interface ExtendableRoom {
  uid: string;
  name: string;
  /** Event-local window, already formatted by the page. */
  whenLabel: string;
}

const field =
  "mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-[#000643] focus:outline-none";

/**
 * Sell an exhibitor more time on a room they have already paid for.
 *
 * Deliberately a separate act from everything else on this page: the rest acts
 * on the order — confirming it, crediting it, closing it — while this creates a
 * NEW order for a NEW booking, with its own payment and its own invoice. Room
 * prices are per duration and not proportional, so the extra time is charged
 * the ordinary package price for its own length rather than a share of the
 * original.
 *
 * Nobody is at a screen when this is agreed, so the payment link is emailed.
 * The link is also shown here: if the mail fails, the desk can read it out
 * rather than leave the exhibitor waiting for a message that never comes.
 */
export default function ExtendBooking({ rooms }: { rooms: ExtendableRoom[] }): JSX.Element | null {
  const router = useRouter();
  const [uid, setUid] = useState(rooms[0]?.uid ?? "");
  const [direction, setDirection] = useState<"before" | "after">("after");
  const [durationHours, setDurationHours] = useState<1 | 2 | 3>(1);

  const extend = trpc.viewer.rooms.extendBooking.useMutation({
    onSuccess: () => router.refresh(),
  });

  if (rooms.length === 0) return null;

  return (
    <section className="mt-4 rounded-xl border border-gray-200 bg-white p-5">
      <h2 className="flex items-center gap-2 font-semibold text-[#000643] text-lg">
        <Clock3 className="h-5 w-5 shrink-0" aria-hidden />
        Sell extra time
      </h2>
      <p className="mt-1 text-gray-600 text-sm">
        Extra time next to a room they already have, charged at the normal price for its own length. It
        becomes a second booking with its own invoice, and the payment link is emailed to the exhibitor.
      </p>

      <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
        {rooms.length > 1 ? (
          <label className="text-sm sm:col-span-3">
            <span className="font-medium text-gray-700">Room</span>
            <select className={field} value={uid} onChange={(e) => setUid(e.target.value)}>
              {rooms.map((r) => (
                <option key={r.uid} value={r.uid}>
                  {r.name} · {r.whenLabel}
                </option>
              ))}
            </select>
          </label>
        ) : null}

        <label className="text-sm">
          <span className="font-medium text-gray-700">When</span>
          <select
            className={field}
            value={direction}
            onChange={(e) => setDirection(e.target.value as "before" | "after")}>
            <option value="after">Runs later — same start</option>
            <option value="before">Starts earlier — same end</option>
          </select>
        </label>

        <label className="text-sm">
          <span className="font-medium text-gray-700">How much</span>
          <select
            className={field}
            value={durationHours}
            onChange={(e) => setDurationHours(Number(e.target.value) as 1 | 2 | 3)}>
            <option value={1}>1 hour</option>
            <option value={2}>2 hours</option>
            <option value={3}>3 hours</option>
          </select>
        </label>

        <div className="flex items-end">
          <button
            type="button"
            disabled={extend.isPending || !uid}
            onClick={() => extend.mutate({ uid, direction, durationHours })}
            className="w-full rounded-lg bg-[#000643] px-4 py-2 font-semibold text-sm text-white transition hover:opacity-90 disabled:opacity-40">
            {extend.isPending ? "Reserving…" : "Reserve and email the link"}
          </button>
        </div>
      </div>

      {rooms.length === 1 ? (
        <p className="mt-2 text-gray-400 text-xs">
          {rooms[0].name} · {rooms[0].whenLabel}
        </p>
      ) : null}

      {extend.error ? <p className="mt-3 text-red-600 text-sm">{extend.error.message}</p> : null}

      {extend.data ? (
        <div className="mt-4 rounded-lg bg-gray-50 px-4 py-3 text-sm">
          <p className="font-semibold text-[#000643]">
            {extend.data.roomName} · {extend.data.slotLabel}
          </p>
          <p className="mt-1 text-gray-600">
            {(extend.data.amountTotal / 100).toFixed(2)} {extend.data.currency} excl. VAT. The room is held
            until that time begins — there is no countdown.
          </p>
          <p className="mt-2 text-gray-600">
            {extend.data.emailed ? (
              <>
                Payment link sent to <strong>{extend.data.bookerEmail}</strong>.
              </>
            ) : (
              <span className="text-amber-700">
                The email could not be sent. Pass this link on instead — the booking itself is fine.
              </span>
            )}
          </p>
          <a
            href={extend.data.checkoutUrl}
            target="_blank"
            rel="noreferrer"
            className="mt-1 block break-all text-[#000643] text-xs underline hover:opacity-80">
            {extend.data.checkoutUrl}
          </a>
        </div>
      ) : null}
    </section>
  );
}
