"use client";

import type { EventDayDefinition } from "@calcom/features/ne26-rooms/lib/eventSchedule";
import { trpc } from "@calcom/trpc/react";
import { CalendarClock, Check, Sparkles } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { EVENT_TIME_ZONE } from "@calcom/features/ne26-rooms/lib/eventSchedule";

const TZ = EVENT_TIME_ZONE;

function dayLabel(date: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: TZ,
    weekday: "long",
    day: "numeric",
    month: "long",
  }).format(new Date(`${date}T12:00:00.000Z`));
}

const HOURS = Array.from({ length: 25 }, (_, h) => h);
const select =
  "mt-1 rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-[#000643] focus:outline-none";

/**
 * Everything that governs *when* a room can be booked, in one place.
 *
 * Opening hours and the cleaning gap used to be two separate cards with two
 * Save buttons, which invited setting one and forgetting the other.
 *
 * There is deliberately no "start step" control any more. Bookings are always
 * one, two or three hours from the hour, and that is not going to change — so
 * the setting existed only to be left alone, while quietly costing inventory
 * whenever it disagreed with the cleaning gap.
 */
export default function EventDaysForm({
  initial,
  bufferMinutes,
}: {
  initial: EventDayDefinition[];
  bufferMinutes: number;
}): JSX.Element {
  const router = useRouter();
  const [days, setDays] = useState<EventDayDefinition[]>(initial);
  const [buffer, setBuffer] = useState(bufferMinutes);
  const save = trpc.viewer.rooms.updateRoomSettings.useMutation({ onSuccess: () => router.refresh() });

  function setHour(date: string, field: "openHour" | "closeHour", value: number): void {
    setDays((rows) => rows.map((d) => (d.date === date ? { ...d, [field]: value } : d)));
  }

  const invalid = days.find((d) => d.openHour >= d.closeHour);

  return (
    <section className="rounded-xl border border-gray-200 bg-white p-5">
      <h2 className="flex items-center gap-2 font-semibold text-[#000643] text-lg">
        <CalendarClock className="h-5 w-5 shrink-0" aria-hidden />
        When rooms can be booked
      </h2>
      <p className="mt-1 text-gray-600 text-sm">
        Drives room availability, the admin calendar and the block editor. All times are Istanbul time.
      </p>

      <div className="mt-4 space-y-2">
        {days.map((d) => (
          <div
            key={d.date}
            className="flex flex-wrap items-end gap-4 rounded-lg border border-gray-100 bg-gray-50 px-4 py-3">
            <span className="min-w-[12rem] font-medium text-gray-800 text-sm">{dayLabel(d.date)}</span>
            <label className="text-sm">
              <span className="block font-medium text-gray-500 text-xs">Opens</span>
              <select
                className={select}
                value={d.openHour}
                onChange={(e) => setHour(d.date, "openHour", Number(e.target.value))}>
                {HOURS.slice(0, 24).map((h) => (
                  <option key={h} value={h}>
                    {String(h).padStart(2, "0")}:00
                  </option>
                ))}
              </select>
            </label>
            <label className="text-sm">
              <span className="block font-medium text-gray-500 text-xs">Closes</span>
              <select
                className={select}
                value={d.closeHour}
                onChange={(e) => setHour(d.date, "closeHour", Number(e.target.value))}>
                {HOURS.slice(1).map((h) => (
                  <option key={h} value={h}>
                    {String(h).padStart(2, "0")}:00
                  </option>
                ))}
              </select>
            </label>
          </div>
        ))}
      </div>
      <p className="mt-2 text-gray-500 text-xs">
        The closing hour is exclusive: no booking may start at or after it.
      </p>

      <div className="mt-6 max-w-sm border-gray-100 border-t pt-5">
        <label>
          <span className="flex items-center gap-1.5 font-medium text-gray-700 text-sm">
            <Sparkles className="h-4 w-4 shrink-0 text-[#000643]" aria-hidden />
            Cleaning time between bookings
          </span>
          <select
            className={`${select} w-full`}
            value={buffer}
            onChange={(e) => setBuffer(Number(e.target.value))}>
            <option value={0}>None — back-to-back bookings</option>
            <option value={15}>15 minutes</option>
            <option value={30}>30 minutes</option>
            <option value={45}>45 minutes</option>
            <option value={60}>1 hour</option>
          </select>
          <span className="mt-1 block text-gray-500 text-xs">
            Held after every booking so the next one cannot start inside it. This takes the time off sale,
            so an hour of cleaning across nine rooms is real inventory.
          </span>
        </label>

      </div>

      <div className="mt-5 flex flex-wrap items-center gap-3">
        <button
          type="button"
          disabled={save.isPending || Boolean(invalid)}
          onClick={() =>
            save.mutate({ eventDays: days, bufferMinutes: buffer })
          }
          className="rounded-lg bg-[#000643] px-4 py-2 font-semibold text-sm text-white transition hover:opacity-90 disabled:opacity-40">
          {save.isPending ? "Saving…" : "Save"}
        </button>
        {save.isSuccess ? (
          <span className="flex items-center gap-1 text-green-600 text-sm">
            <Check className="h-4 w-4" aria-hidden />
            Saved
          </span>
        ) : null}
        {invalid ? (
          <span className="text-red-600 text-sm">Opening hour must be before closing hour.</span>
        ) : null}
      </div>
      {save.error ? <p className="mt-2 text-red-600 text-sm">{save.error.message}</p> : null}
    </section>
  );
}
