"use client";

import { trpc } from "@calcom/trpc/react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

export interface AddOnRow {
  id: number;
  name: string;
  priceType: string;
  price: number;
  currency: string;
  vatRate: number;
  isActive: boolean;
}

const cellInput =
  "w-24 rounded-md border border-gray-200 px-2 py-1 text-sm focus:border-[#000643] focus:outline-none";

export default function AddOnsManager({ addOns }: { addOns: AddOnRow[] }): JSX.Element {
  const router = useRouter();
  const [draft, setDraft] = useState<AddOnRow[]>(addOns);
  const [savingId, setSavingId] = useState<number | null>(null);
  const update = trpc.viewer.rooms.updateAddOn.useMutation({
    onSettled: () => setSavingId(null),
    onSuccess: () => router.refresh(),
  });

  function setField(id: number, field: keyof AddOnRow, value: number | boolean): void {
    setDraft((rows) => rows.map((r) => (r.id === id ? { ...r, [field]: value } : r)));
  }

  function save(row: AddOnRow): void {
    setSavingId(row.id);
    update.mutate({ id: row.id, price: row.price, vatRate: row.vatRate, isActive: row.isActive });
  }

  return (
    <div>
      <Link href="/rooms/admin" className="text-gray-500 text-sm hover:text-[#000643]">
        ← Back to admin
      </Link>
      <h1 className="mt-2 font-bold text-2xl text-[#000643]">Manage add-ons</h1>
      <p className="mt-1 text-gray-600 text-sm">
        Edit each add-on's unit price, VAT rate (%) and whether it's offered.
      </p>

      <div className="mt-4 overflow-x-auto rounded-xl border border-gray-200 bg-white">
        <table className="w-full text-left text-sm">
          <thead className="border-gray-100 border-b bg-gray-50 text-gray-500 text-xs uppercase">
            <tr>
              <th className="px-3 py-2">Add-on</th>
              <th className="px-3 py-2">Pricing</th>
              <th className="px-3 py-2">Unit price</th>
              <th className="px-3 py-2">VAT %</th>
              <th className="px-3 py-2">Active</th>
              <th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody>
            {draft.map((r) => (
              <tr key={r.id} className="border-gray-50 border-b last:border-0">
                <td className="px-3 py-2 font-medium">{r.name}</td>
                <td className="px-3 py-2 text-gray-400 text-xs">{r.priceType}</td>
                <td className="px-3 py-2">
                  <input
                    type="number"
                    min={0}
                    step="1"
                    className={cellInput}
                    value={Math.round(r.price) / 100}
                    onChange={(e) =>
                      setField(r.id, "price", Math.round(Math.max(0, Number(e.target.value)) * 100))
                    }
                  />
                </td>
                <td className="px-3 py-2">
                  <input
                    type="number"
                    min={0}
                    max={100}
                    step="0.1"
                    className={`${cellInput} w-20`}
                    value={r.vatRate / 100}
                    onChange={(e) =>
                      setField(
                        r.id,
                        "vatRate",
                        Math.round(Math.min(100, Math.max(0, Number(e.target.value))) * 100)
                      )
                    }
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
