"use client";

import { trpc } from "@calcom/trpc/react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

export interface RoomRow {
  id: number;
  name: string;
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

const cellInput =
  "w-24 rounded-md border border-gray-200 px-2 py-1 text-sm focus:border-[#000643] focus:outline-none";

// Prices are stored in cents; the admin edits them in whole currency units.
function toUnits(cents: number): number {
  return Math.round(cents) / 100;
}
function toCents(units: number): number {
  return Math.round(units * 100);
}

export default function RoomsManager({ rooms }: { rooms: RoomRow[] }): JSX.Element {
  const router = useRouter();
  const [draft, setDraft] = useState<RoomRow[]>(rooms);
  const [savingId, setSavingId] = useState<number | null>(null);
  const update = trpc.viewer.rooms.updateResource.useMutation({
    onSettled: () => setSavingId(null),
    onSuccess: () => router.refresh(),
  });

  function setField(id: number, field: keyof RoomRow, value: number | boolean | string): void {
    setDraft((rows) => rows.map((r) => (r.id === id ? { ...r, [field]: value } : r)));
  }

  function save(row: RoomRow): void {
    setSavingId(row.id);
    update.mutate({
      id: row.id,
      capacity: row.capacity,
      surface: row.surface,
      price1h: row.price1h,
      price2h: row.price2h,
      price3h: row.price3h,
      imageUrl: row.imageUrl,
      isActive: row.isActive,
    });
  }

  return (
    <div>
      <Link href="/rooms/admin" className="text-gray-500 text-sm hover:text-[#000643]">
        ← Back to admin
      </Link>
      <h1 className="mt-2 font-bold text-2xl text-[#000643]">Manage rooms</h1>
      <p className="mt-1 text-gray-600 text-sm">
        Edit prices (in {draft[0]?.currency ?? "EUR"}), capacity, surface and whether a room is bookable.
      </p>

      <div className="mt-4 overflow-x-auto rounded-xl border border-gray-200 bg-white">
        <table className="w-full text-left text-sm">
          <thead className="border-gray-100 border-b bg-gray-50 text-gray-500 text-xs uppercase">
            <tr>
              <th className="px-3 py-2">Room</th>
              <th className="px-3 py-2">Cap.</th>
              <th className="px-3 py-2">m²</th>
              <th className="px-3 py-2">1h</th>
              <th className="px-3 py-2">2h</th>
              <th className="px-3 py-2">3h</th>
              <th className="px-3 py-2">Image (URL / path)</th>
              <th className="px-3 py-2">Active</th>
              <th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody>
            {draft.map((r) => (
              <tr key={r.id} className="border-gray-50 border-b last:border-0">
                <td className="px-3 py-2">
                  <div className="font-medium">{r.name}</div>
                  <div className="text-gray-400 text-xs">{r.category}</div>
                </td>
                <td className="px-3 py-2">
                  <input
                    type="number"
                    min={0}
                    className={`${cellInput} w-16`}
                    value={r.capacity}
                    onChange={(e) => setField(r.id, "capacity", Math.max(0, Number(e.target.value)))}
                  />
                </td>
                <td className="px-3 py-2">
                  <input
                    type="number"
                    min={0}
                    className={`${cellInput} w-16`}
                    value={r.surface}
                    onChange={(e) => setField(r.id, "surface", Math.max(0, Number(e.target.value)))}
                  />
                </td>
                {(["price1h", "price2h", "price3h"] as const).map((key) => (
                  <td key={key} className="px-3 py-2">
                    <input
                      type="number"
                      min={0}
                      step="1"
                      className={cellInput}
                      value={toUnits(r[key])}
                      onChange={(e) => setField(r.id, key, toCents(Math.max(0, Number(e.target.value))))}
                    />
                  </td>
                ))}
                <td className="px-3 py-2">
                  <input
                    type="text"
                    placeholder="/rooms/suite-1.jpg"
                    className={`${cellInput} w-48`}
                    value={r.imageUrl}
                    onChange={(e) => setField(r.id, "imageUrl", e.target.value)}
                  />
                </td>
                <td className="px-3 py-2">
                  <input
                    type="checkbox"
                    checked={r.isActive}
                    onChange={(e) => setField(r.id, "isActive", e.target.checked)}
                    className="h-4 w-4 accent-[#000643]"
                  />
                </td>
                <td className="px-3 py-2">
                  <button
                    type="button"
                    onClick={() => save(r)}
                    disabled={savingId === r.id}
                    className="rounded-md bg-[#000643] px-3 py-1 font-semibold text-white text-xs transition hover:opacity-90 disabled:opacity-40">
                    {savingId === r.id ? "Saving…" : "Save"}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {update.error ? <p className="mt-3 text-red-600 text-sm">{update.error.message}</p> : null}
    </div>
  );
}
