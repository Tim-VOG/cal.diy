"use client";

import { trpc } from "@calcom/trpc/react";
import { useRouter } from "next/navigation";
import { useState } from "react";

/**
 * Cancel one paid room, from the exhibitor's own page.
 *
 * It refunds real money the moment it is pressed, so it asks first and names
 * the room and the day going. Only that room: a payment covering three rooms
 * keeps the other two, and they stay invoiced.
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
  const [done, setDone] = useState(false);
  const cancel = trpc.viewer.rooms.cancelMyBooking.useMutation({
    onSuccess: () => {
      setDone(true);
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

  return (
    <span className="inline-flex flex-col items-start gap-1">
      <button
        type="button"
        disabled={cancel.isPending}
        onClick={() => {
          // Named in full: the exhibitor may hold the same room on two days,
          // and "cancel this booking" would not say which one goes.
          const what = `${roomLabel} on ${dayLabel}`;
          if (!window.confirm(`Cancel ${what} and be refunded ${amountLabel}? This cannot be undone.`)) {
            return;
          }
          cancel.mutate({ uid: bookingUid });
        }}
        className="whitespace-nowrap rounded-md border border-red-200 bg-white px-2 py-0.5 font-medium text-[11px] text-red-600 transition hover:border-red-400 disabled:opacity-50">
        {cancel.isPending ? "Cancelling…" : "Cancel room"}
      </button>
      {cancel.error ? (
        <span role="alert" className="text-red-700 text-xs">
          {cancel.error.message}
        </span>
      ) : null}
    </span>
  );
}
