"use client";

import { trpc } from "@calcom/trpc/react";
import { useRouter } from "next/navigation";
import { useState } from "react";

/**
 * Cancel one paid room, from the exhibitor's own page.
 *
 * It refunds real money the moment it is confirmed, so it asks first and names
 * the room, the day and the amount. Only that room: a payment covering three
 * rooms keeps the other two, and they stay invoiced.
 *
 * The question is asked in the page rather than through window.confirm. A
 * browser dialog is not reliably shown — an embedded browser swallows it, and
 * any browser lets someone switch it off for the rest of the session with the
 * "don't let this page create more dialogs" box. Both end the same way: the
 * button appears to do nothing at all, with no error and nothing in the log.
 * An amount somebody is about to be refunded should not ride on that.
 */
export default function CancelBookingButton({
  bookingUid,
  amountLabel,
  roomLabel,
  dayLabel,
}: {
  bookingUid: string;
  /** What this room alone comes back to, VAT included. */
  amountLabel: string;
  roomLabel: string;
  dayLabel: string;
}): JSX.Element {
  const router = useRouter();
  const [asking, setAsking] = useState(false);
  const [done, setDone] = useState(false);
  const cancel = trpc.viewer.rooms.cancelMyBooking.useMutation({
    onSuccess: () => {
      setDone(true);
      setAsking(false);
      router.refresh();
    },
  });

  if (done) {
    return (
      <p role="status" className="text-green-800 text-xs">
        Cancelled. Your refund of {amountLabel} is on its way, and the credit note will arrive by email in a
        few minutes.
      </p>
    );
  }

  if (asking) {
    return (
      <span className="inline-flex flex-col items-start gap-1.5">
        {/* Named in full: an exhibitor may hold the same room on two days, and
            "cancel this booking" would not say which one goes. */}
        <span className="text-[11px] text-gray-700 leading-snug">
          Give up <span className="font-medium">{roomLabel}</span> on {dayLabel} and be refunded{" "}
          <span className="font-medium">{amountLabel}</span>? This cannot be undone.
        </span>
        <span className="inline-flex gap-1.5">
          <button
            type="button"
            disabled={cancel.isPending}
            onClick={() => cancel.mutate({ uid: bookingUid })}
            className="whitespace-nowrap rounded-md bg-red-600 px-2 py-1 font-medium text-[11px] text-white transition hover:bg-red-700 disabled:opacity-50">
            {cancel.isPending ? "Cancelling…" : "Yes, cancel it"}
          </button>
          <button
            type="button"
            disabled={cancel.isPending}
            onClick={() => {
              setAsking(false);
              cancel.reset();
            }}
            className="whitespace-nowrap rounded-md border border-gray-200 px-2 py-1 font-medium text-[11px] text-gray-700 transition hover:border-gray-400 disabled:opacity-50">
            Keep it
          </button>
        </span>
        {cancel.error ? (
          <span role="alert" className="max-w-[16rem] text-red-700 text-xs leading-snug">
            {cancel.error.message}
          </span>
        ) : null}
      </span>
    );
  }

  return (
    <button
      type="button"
      onClick={() => setAsking(true)}
      className="whitespace-nowrap rounded-md border border-red-200 bg-white px-2 py-0.5 font-medium text-[11px] text-red-600 transition hover:border-red-400">
      Cancel room
    </button>
  );
}
