"use client";

import type { EventDayDefinition } from "@calcom/features/ne26-rooms/lib/eventSchedule";
import { trpc } from "@calcom/trpc/react";
import { useRouter } from "next/navigation";
import { useState } from "react";

const TZ = "Europe/Brussels";

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

export default function EventDaysForm({ initial }: { initial: EventDayDefinition[] }): JSX.Element {
  const router = useRouter();
  const [days, setDays] = useState<EventDayDefinition[]>(initial);
  const save = trpc.viewer.rooms.updateRoomSettings.useMutation({ onSuccess: () => router.refresh() });

  function setHour(date: string, field: "openHourBrussels" | "closeHourBrussels", value: number): void {
    setDays((rows) => rows.map((d) => (d.date === date ? { ...d, [field]: value } : d)));
  }

  const invalid = days.find((d) => d.openHourBrussels >= d.closeHourBrussels);

  return (
    <div className="mt-8 rounded-xl border border-gray-200 bg-white p-5">
      <h2 className="font-semibold text-[#000643] text-lg">Event opening hours</h2>
      <p className="mt-1 text-gray-600 text-sm">
        Set the opening and closing hour for each event day (Brussels time). This drives room availability,
        the admin calendar and the block editor. Closing hour is exclusive — no booking may start at or after
        it.
      </p>

      <div className="mt-4 space-y-3">
        {days.map((d) => (
          <div
            key={d.date}
            className="flex flex-wrap items-end gap-4 rounded-lg border border-gray-100 bg-gray-50 px-4 py-3">
            <span className="min-w-[12rem] font-medium text-gray-800 text-sm">{dayLabel(d.date)}</span>
            <label className="text-sm">
              <span className="block font-medium text-gray-500 text-xs">Opens</span>
              <select
                className={select}
                value={d.openHourBrussels}
                onChange={(e) => setHour(d.date, "openHourBrussels", Number(e.target.value))}>
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
                value={d.closeHourBrussels}
                onChange={(e) => setHour(d.date, "closeHourBrussels", Number(e.target.value))}>
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

      <div className="mt-4 flex items-center gap-3">
        <button
          type="button"
          disabled={save.isPending || Boolean(invalid)}
          onClick={() => save.mutate({ eventDays: days })}
          className="rounded-lg bg-[#000643] px-4 py-2 font-semibold text-sm text-white transition hover:opacity-90 disabled:opacity-40">
          {save.isPending ? "Saving…" : "Save opening hours"}
        </button>
        {save.isSuccess ? <span className="text-green-600 text-sm">Saved ✓</span> : null}
        {invalid ? (
          <span className="text-red-600 text-sm">Opening hour must be before closing hour.</span>
        ) : null}
      </div>
      {save.error ? <p className="mt-2 text-red-600 text-sm">{save.error.message}</p> : null}
    </div>
  );
}
