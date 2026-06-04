"use client";

import {
  type DurationHours,
  EVENT_SCHEDULE,
  SELECTABLE_DURATIONS,
} from "@calcom/features/ne26-rooms/lib/eventSchedule";
import { trpc } from "@calcom/trpc/react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";

const TZ = "Europe/Brussels";

interface RoomOption {
  slug: string;
  name: string;
}
interface BlockRow {
  uid: string;
  roomName: string;
  startUtc: string;
  endUtc: string;
  durationMinutes: number;
}

function fmtDateTime(iso: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: TZ,
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(iso));
}

// Start <option>s at the configured granularity (e.g. hourly), across the event.
function buildStartOptions(granularityMinutes: number): { iso: string; label: string }[] {
  const stepMs = Math.max(15, granularityMinutes) * 60 * 1000;
  return EVENT_SCHEDULE.flatMap((day) => {
    const dayOpenMs = day.openSlotStartsUtc[0]?.getTime() ?? 0;
    return day.openSlotStartsUtc
      .filter((d) => (d.getTime() - dayOpenMs) % stepMs === 0)
      .map((d) => ({ iso: d.toISOString(), label: fmtDateTime(d.toISOString()) }));
  });
}

const inputClass =
  "rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-[#000643] focus:outline-none";

export default function BlocksManager({
  rooms,
  blocks,
  granularityMinutes,
}: {
  rooms: RoomOption[];
  blocks: BlockRow[];
  granularityMinutes: number;
}): JSX.Element {
  const router = useRouter();
  const startOptions = useMemo(() => buildStartOptions(granularityMinutes), [granularityMinutes]);
  const [slug, setSlug] = useState(rooms[0]?.slug ?? "");
  const [startUtc, setStartUtc] = useState(startOptions[0]?.iso ?? "");
  const [durationHours, setDurationHours] = useState<DurationHours>(1);

  const refresh = { onSuccess: () => router.refresh() };
  const create = trpc.viewer.rooms.createBlock.useMutation(refresh);
  const remove = trpc.viewer.rooms.removeBlock.useMutation(refresh);

  return (
    <div className="mx-auto max-w-3xl">
      <Link href="/rooms/admin" className="text-gray-500 text-sm hover:text-[#000643]">
        ← Back to admin
      </Link>
      <h1 className="mt-2 font-bold text-2xl text-[#000643]">Blocked slots</h1>
      <p className="mt-1 text-gray-600 text-sm">
        Block a room for maintenance or internal use. A block reserves the slot like a confirmed booking, so
        it can&apos;t be booked. It&apos;s rejected if it overlaps an existing booking.
      </p>

      <div className="mt-5 rounded-xl border border-gray-200 bg-white p-5">
        <h2 className="font-semibold text-gray-500 text-xs uppercase tracking-wide">New block</h2>
        <div className="mt-3 flex flex-wrap items-end gap-3">
          <label className="text-sm">
            <span className="block font-medium text-gray-700">Room</span>
            <select className={`${inputClass} mt-1`} value={slug} onChange={(e) => setSlug(e.target.value)}>
              {rooms.map((r) => (
                <option key={r.slug} value={r.slug}>
                  {r.name}
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm">
            <span className="block font-medium text-gray-700">Start (Brussels)</span>
            <select
              className={`${inputClass} mt-1`}
              value={startUtc}
              onChange={(e) => setStartUtc(e.target.value)}>
              {startOptions.map((o) => (
                <option key={o.iso} value={o.iso}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm">
            <span className="block font-medium text-gray-700">Duration</span>
            <select
              className={`${inputClass} mt-1`}
              value={durationHours}
              onChange={(e) => setDurationHours(Number(e.target.value) as DurationHours)}>
              {SELECTABLE_DURATIONS.map((d) => (
                <option key={d} value={d}>
                  {d}h
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            disabled={create.isPending || !slug || !startUtc}
            onClick={() => create.mutate({ slug, startUtc, durationHours })}
            className="rounded-lg bg-[#000643] px-4 py-2 font-semibold text-sm text-white transition hover:opacity-90 disabled:opacity-40">
            {create.isPending ? "Blocking…" : "Block slot"}
          </button>
        </div>
        {create.error ? <p className="mt-2 text-red-600 text-sm">{create.error.message}</p> : null}
      </div>

      <div className="mt-5 overflow-x-auto rounded-xl border border-gray-200 bg-white">
        <table className="w-full text-left text-sm">
          <thead className="border-gray-100 border-b bg-gray-50 text-gray-500 text-xs uppercase">
            <tr>
              <th className="px-3 py-2">Room</th>
              <th className="px-3 py-2">When (Brussels)</th>
              <th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody>
            {blocks.length === 0 ? (
              <tr>
                <td className="px-3 py-6 text-center text-gray-400" colSpan={3}>
                  No blocked slots
                </td>
              </tr>
            ) : (
              blocks.map((b) => (
                <tr key={b.uid} className="border-gray-50 border-b last:border-0">
                  <td className="px-3 py-2 font-medium">{b.roomName}</td>
                  <td className="px-3 py-2">
                    {fmtDateTime(b.startUtc)} – {fmtDateTime(b.endUtc)} ({b.durationMinutes / 60}h)
                  </td>
                  <td className="px-3 py-2">
                    <button
                      type="button"
                      disabled={remove.isPending}
                      onClick={() => {
                        if (window.confirm("Remove this block and free the slot?"))
                          remove.mutate({ uid: b.uid });
                      }}
                      className="rounded-md border border-red-200 px-2 py-1 font-medium text-red-600 text-xs transition hover:border-red-400 disabled:opacity-50">
                      Remove
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
