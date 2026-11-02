"use client";

import { trpc } from "@calcom/trpc/react";
import { useRouter } from "next/navigation";
import { useState } from "react";

/**
 * Whether catering is on sale at all.
 *
 * Rooms and catering stop selling at different moments, and nothing in the app
 * knew that: a room is sellable until its slot starts, while the kitchen's
 * order goes in days earlier and cannot be added to afterwards. Catering was
 * therefore still being offered — on the room page, at the counter and as a
 * top-up — for meals nobody could cook.
 *
 * Closed is the safe position, so that is the default. Opening it is a
 * deliberate act, taken after the kitchen has said they will take more.
 *
 * This switch is the only authority on the question: the app keeps no deadline
 * of its own alongside it. The kitchen's real cut-off is an agreement between
 * the organiser and the caterer, it moves, and a clock in here that disagreed
 * with them would either refuse a sale they had accepted or offer one they had
 * not. One switch, in the hands of the person who talks to the kitchen.
 */
export default function CateringSalesSwitch({ open }: { open: boolean }): JSX.Element {
  const router = useRouter();
  const [value, setValue] = useState(open);
  const save = trpc.viewer.rooms.updateRoomSettings.useMutation({
    onSuccess: (s) => {
      setValue(s.cateringSalesOpen);
      router.refresh();
    },
    onError: () => setValue(open),
  });

  const toggle = () => {
    const next = !value;
    setValue(next);
    save.mutate({ cateringSalesOpen: next });
  };

  return (
    <div className="mt-5 rounded-xl border border-gray-200 bg-white p-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="font-semibold text-[#000643] text-xs uppercase tracking-wide">Catering on sale</h2>
          <p className="mt-1 max-w-prose text-gray-600 text-sm">
            {value
              ? "Exhibitors can order catering with a room, add it to a room they have already paid for, and the counter can sell it."
              : "Catering is off sale everywhere. Rooms keep selling as normal — only the food is hidden, and an order that tries anyway is refused."}
          </p>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={value}
          aria-label="Catering on sale"
          disabled={save.isPending}
          onClick={toggle}
          className={`relative h-7 w-12 shrink-0 rounded-full transition disabled:opacity-50 ${
            value ? "bg-[#000643]" : "bg-gray-300"
          }`}>
          <span
            className={`absolute top-1 h-5 w-5 rounded-full bg-white transition-all ${
              value ? "left-6" : "left-1"
            }`}
          />
        </button>
      </div>
      <p className="mt-3 font-medium text-sm">
        {value ? (
          <span className="text-green-800">Open — exhibitors can order catering.</span>
        ) : (
          <span className="text-gray-700">Closed — nobody can order catering.</span>
        )}
      </p>
      {save.error ? (
        <p role="alert" className="mt-2 text-red-700 text-xs">
          {save.error.message}
        </p>
      ) : null}
    </div>
  );
}
