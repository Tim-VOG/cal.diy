"use client";

import { EVENT_TIME_ZONE } from "@calcom/features/ne26-rooms/lib/eventSchedule";
import { trpc } from "@calcom/trpc/react";
import { useRouter } from "next/navigation";
import { useState } from "react";

/**
 * How long before the event an exhibitor may still cancel their own room.
 *
 * This was seven days, written into the code. The first time somebody needed to
 * cancel four days out, the button was simply gone from "My bookings" with no
 * way to bring it back short of a deploy — and the desk had to do by hand what
 * the exhibitor could have done themselves.
 *
 * So the window is set here, by whoever answers for the refunds. Zero keeps it
 * open until the event opens, which is as far as it goes: a room cannot be
 * given back in full while it is being used, or once it has been.
 */
export default function CancellationWindowForm({
  days,
  deadlineUtc,
}: {
  days: number;
  /** The resulting instant, computed on the server from the event's own days. */
  deadlineUtc: string | null;
}): JSX.Element {
  const router = useRouter();
  const [value, setValue] = useState(String(days));
  const save = trpc.viewer.rooms.updateRoomSettings.useMutation({
    onSuccess: (s) => {
      setValue(String(s.cancellationDeadlineDays));
      router.refresh();
    },
  });

  const parsed = Number.parseInt(value, 10);
  const valid = Number.isInteger(parsed) && parsed >= 0 && parsed <= 365;
  const dirty = valid && parsed !== days;
  const closed = deadlineUtc ? new Date(deadlineUtc).getTime() <= Date.now() : false;

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-5">
      <h2 className="font-semibold text-[#000643] text-xs uppercase tracking-wide">Cancellation window</h2>
      <p className="mt-1 max-w-prose text-gray-600 text-sm">
        How long before the event an exhibitor can cancel a room themselves from “My bookings”. Cancelling
        refunds that room to their card in full, VAT included, and leaves any other room on the same payment
        booked. Past the deadline the button disappears and they are told to write to the desk.
      </p>

      <div className="mt-4 flex flex-wrap items-end gap-3">
        <label className="block">
          <span className="block font-medium text-[#000643] text-sm">Closes this many days before</span>
          <input
            type="number"
            min={0}
            max={365}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            className="mt-1 w-28 rounded-lg border border-gray-200 px-3 py-2 text-[#000643] tabular-nums focus:border-[#000643] focus:outline-none"
          />
        </label>
        <button
          type="button"
          disabled={!dirty || save.isPending}
          onClick={() => save.mutate({ cancellationDeadlineDays: parsed })}
          className="rounded-lg bg-[#000643] px-4 py-2.5 font-medium text-sm text-white transition hover:opacity-90 disabled:opacity-40">
          {save.isPending ? "Saving…" : "Save"}
        </button>
      </div>

      <p className="mt-3 text-sm">
        {deadlineUtc ? (
          closed ? (
            <span className="text-gray-700">
              Closed since {longInstant(deadlineUtc)} — no exhibitor can cancel online right now.
            </span>
          ) : (
            <span className="text-green-800">Open until {longInstant(deadlineUtc)}.</span>
          )
        ) : (
          <span className="text-gray-700">No event days are configured, so nothing can be cancelled.</span>
        )}
      </p>
      <p className="mt-1 text-gray-500 text-xs">
        0 keeps it open until the event opens. Times are {EVENT_TIME_ZONE.replace("_", " ")}.
      </p>

      {save.error ? (
        <p role="alert" className="mt-2 text-red-700 text-xs">
          {save.error.message}
        </p>
      ) : null}
    </div>
  );
}

function longInstant(iso: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: EVENT_TIME_ZONE,
    weekday: "long",
    day: "numeric",
    month: "long",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(iso));
}
