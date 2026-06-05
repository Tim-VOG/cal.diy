"use client";

import type { EventDayDefinition } from "@calcom/features/ne26-rooms/lib/eventSchedule";
import { trpc } from "@calcom/trpc/react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import EventDaysForm from "./EventDaysForm";

const CATEGORIES = ["PREMIUM", "INTERMEDIATE", "ENTRY"] as const;

export interface RoomRow {
  id: number;
  name: string;
  description: string;
  category: string;
  capacity: number;
  surface: number;
  price1h: number;
  price2h: number;
  price3h: number;
  currency: string;
  imageUrl: string;
  isActive: boolean;
}

const input =
  "mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-[#000643] focus:outline-none";
const label = "block font-medium text-gray-500 text-xs";

function toUnits(cents: number): number {
  return Math.round(cents) / 100;
}
function toCents(units: number): number {
  return Math.round(units * 100);
}

export default function RoomsManager({
  rooms,
  bufferMinutes,
  slotGranularityMinutes,
  eventDays,
}: {
  rooms: RoomRow[];
  bufferMinutes: number;
  slotGranularityMinutes: number;
  eventDays: EventDayDefinition[];
}): JSX.Element {
  const router = useRouter();
  const [draft, setDraft] = useState<RoomRow[]>(rooms);
  const [savingId, setSavingId] = useState<number | null>(null);
  const [buffer, setBuffer] = useState(bufferMinutes);
  const [granularity, setGranularity] = useState(slotGranularityMinutes);
  const update = trpc.viewer.rooms.updateResource.useMutation({
    onSettled: () => setSavingId(null),
    onSuccess: () => router.refresh(),
  });
  const updateSettings = trpc.viewer.rooms.updateRoomSettings.useMutation({
    onSuccess: () => router.refresh(),
  });

  function setField(id: number, field: keyof RoomRow, value: number | boolean | string): void {
    setDraft((rows) => rows.map((r) => (r.id === id ? { ...r, [field]: value } : r)));
  }

  function save(row: RoomRow): void {
    setSavingId(row.id);
    update.mutate({
      id: row.id,
      name: row.name,
      description: row.description,
      category: row.category as (typeof CATEGORIES)[number],
      capacity: row.capacity,
      surface: row.surface,
      price1h: row.price1h,
      price2h: row.price2h,
      price3h: row.price3h,
      imageUrl: row.imageUrl,
      isActive: row.isActive,
    });
  }

  const currency = draft[0]?.currency ?? "EUR";

  return (
    <div>
      <h1 className="font-bold text-2xl text-[#000643]">Manage rooms</h1>
      <p className="mt-1 text-gray-600 text-sm">
        Edit each room's details. Prices are excl. VAT, in {currency}.
      </p>

      {/* Booking settings */}
      <div className="mt-5 rounded-xl border border-gray-200 bg-white p-5">
        <h2 className="font-semibold text-[#000643] text-xs uppercase tracking-wide">Booking settings</h2>
        <p className="mt-1 text-gray-500 text-xs">
          Slot granularity = the start step offered to bookers. Buffer = turnover gap after each booking
          (multiple of 15; 0 disables it).
        </p>
        <div className="mt-3 flex flex-wrap items-end gap-3">
          <label className="text-sm">
            <span className="block font-medium text-gray-700">Slot granularity</span>
            <select
              className="mt-1 w-36 rounded-md border border-gray-200 px-2 py-1 text-sm focus:border-[#000643] focus:outline-none"
              value={granularity}
              onChange={(e) => setGranularity(Number(e.target.value))}>
              <option value={60}>1 hour</option>
              <option value={30}>30 minutes</option>
              <option value={15}>15 minutes</option>
            </select>
          </label>
          <label className="text-sm">
            <span className="block font-medium text-gray-700">Buffer (minutes)</span>
            <input
              type="number"
              min={0}
              max={240}
              step={15}
              className="mt-1 w-28 rounded-md border border-gray-200 px-2 py-1 text-sm focus:border-[#000643] focus:outline-none"
              value={buffer}
              onChange={(e) => setBuffer(Math.max(0, Math.min(240, Number(e.target.value))))}
            />
          </label>
          <button
            type="button"
            onClick={() =>
              updateSettings.mutate({
                bufferMinutes: buffer,
                slotGranularityMinutes: granularity as 15 | 30 | 60,
              })
            }
            disabled={updateSettings.isPending}
            className="rounded-md bg-[#000643] px-3 py-1.5 font-semibold text-white text-xs transition hover:opacity-90 disabled:opacity-40">
            {updateSettings.isPending ? "Saving…" : "Save settings"}
          </button>
          {updateSettings.isSuccess ? <span className="text-green-600 text-xs">Saved ✓</span> : null}
        </div>
      </div>

      <EventDaysForm initial={eventDays} />

      {/* Room cards */}
      <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {draft.map((r) => (
          <div key={r.id} className="flex flex-col rounded-xl border border-gray-200 bg-white p-5">
            <div className="flex items-start justify-between gap-3">
              <input
                type="text"
                className={`${input} mt-0 font-semibold text-[#000643]`}
                value={r.name}
                onChange={(e) => setField(r.id, "name", e.target.value)}
              />
              <label className="flex shrink-0 items-center gap-1.5 pt-2 text-gray-600 text-xs">
                <input
                  type="checkbox"
                  checked={r.isActive}
                  onChange={(e) => setField(r.id, "isActive", e.target.checked)}
                  className="h-4 w-4 accent-[#000643]"
                />
                Active
              </label>
            </div>

            <div className="mt-3 grid grid-cols-2 gap-3">
              <label>
                <span className={label}>Category</span>
                <select
                  className={input}
                  value={r.category}
                  onChange={(e) => setField(r.id, "category", e.target.value)}>
                  {CATEGORIES.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <span className={label}>Capacity</span>
                <input
                  type="number"
                  min={0}
                  className={input}
                  value={r.capacity}
                  onChange={(e) => setField(r.id, "capacity", Math.max(0, Number(e.target.value)))}
                />
              </label>
              <label>
                <span className={label}>Surface (m²)</span>
                <input
                  type="number"
                  min={0}
                  className={input}
                  value={r.surface}
                  onChange={(e) => setField(r.id, "surface", Math.max(0, Number(e.target.value)))}
                />
              </label>
              <div />
              {(["price1h", "price2h", "price3h"] as const).map((key, i) => (
                <label key={key}>
                  <span className={label}>
                    {i + 1}h price ({currency})
                  </span>
                  <input
                    type="number"
                    min={0}
                    className={input}
                    value={toUnits(r[key])}
                    onChange={(e) => setField(r.id, key, toCents(Math.max(0, Number(e.target.value))))}
                  />
                </label>
              ))}
            </div>

            <label className="mt-3 block">
              <span className={label}>Description</span>
              <textarea
                rows={2}
                className={input}
                value={r.description}
                onChange={(e) => setField(r.id, "description", e.target.value)}
              />
            </label>
            <label className="mt-3 block">
              <span className={label}>Image (URL / path)</span>
              <input
                type="text"
                placeholder="/rooms/suite-1.jpg"
                className={input}
                value={r.imageUrl}
                onChange={(e) => setField(r.id, "imageUrl", e.target.value)}
              />
            </label>

            <button
              type="button"
              onClick={() => save(r)}
              disabled={savingId === r.id}
              className="mt-4 self-start rounded-lg bg-[#000643] px-4 py-2 font-semibold text-sm text-white transition hover:opacity-90 disabled:opacity-40">
              {savingId === r.id ? "Saving…" : "Save room"}
            </button>
          </div>
        ))}
      </div>

      {update.error ? <p className="mt-3 text-red-600 text-sm">{update.error.message}</p> : null}
    </div>
  );
}
