"use client";

import { trpc } from "@calcom/trpc/react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

export interface AddOnRow {
  id: number;
  name: string;
  description: string;
  priceType: string;
  price: number;
  currency: string;
  vatRate: number;
  isActive: boolean;
}

const PRICE_TYPES = [
  { value: "FLAT", label: "Flat" },
  { value: "PER_PERSON", label: "Per person" },
  { value: "PER_HOUR", label: "Per hour" },
] as const;
type PriceType = (typeof PRICE_TYPES)[number]["value"];

const cellInput =
  "w-24 rounded-md border border-gray-200 px-2 py-1 text-sm focus:border-[#000643] focus:outline-none";

export default function AddOnsManager({ addOns }: { addOns: AddOnRow[] }): JSX.Element {
  const router = useRouter();
  const [draft, setDraft] = useState<AddOnRow[]>(addOns);
  const [savingId, setSavingId] = useState<number | null>(null);
  const refreshOnly = { onSuccess: () => router.refresh() };
  const update = trpc.viewer.rooms.updateAddOn.useMutation({
    onSettled: () => setSavingId(null),
    onSuccess: () => router.refresh(),
  });
  const remove = trpc.viewer.rooms.deleteAddOn.useMutation(refreshOnly);
  const create = trpc.viewer.rooms.createAddOn.useMutation({
    onSuccess: () => {
      setNewName("");
      setNewPrice(0);
      router.refresh();
    },
  });

  const [newName, setNewName] = useState("");
  const [newType, setNewType] = useState<PriceType>("FLAT");
  const [newPrice, setNewPrice] = useState(0);
  const [newVat, setNewVat] = useState(21);

  function setField(id: number, field: keyof AddOnRow, value: number | boolean | string): void {
    setDraft((rows) => rows.map((r) => (r.id === id ? { ...r, [field]: value } : r)));
  }

  function save(row: AddOnRow): void {
    setSavingId(row.id);
    update.mutate({
      id: row.id,
      name: row.name,
      description: row.description,
      priceType: row.priceType as PriceType,
      price: row.price,
      vatRate: row.vatRate,
      isActive: row.isActive,
    });
  }

  const error = update.error ?? remove.error ?? create.error;

  return (
    <div>
      <Link href="/rooms/admin" className="text-gray-500 text-sm hover:text-[#000643]">
        ← Back to admin
      </Link>
      <h1 className="mt-2 font-bold text-2xl text-[#000643]">Manage add-ons</h1>
      <p className="mt-1 text-gray-600 text-sm">
        Create, edit or remove add-ons. Prices are excl. VAT; VAT rate in %.
      </p>

      {/* Create */}
      <div className="mt-4 rounded-xl border border-gray-200 bg-white p-5">
        <h2 className="font-semibold text-[#000643] text-xs uppercase tracking-wide">New add-on</h2>
        <div className="mt-3 flex flex-wrap items-end gap-3">
          <label className="text-sm">
            <span className="block font-medium text-gray-700">Name</span>
            <input
              type="text"
              className={`${cellInput} w-44`}
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
            />
          </label>
          <label className="text-sm">
            <span className="block font-medium text-gray-700">Pricing</span>
            <select
              className={`${cellInput} w-32`}
              value={newType}
              onChange={(e) => setNewType(e.target.value as PriceType)}>
              {PRICE_TYPES.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm">
            <span className="block font-medium text-gray-700">Price (excl. VAT)</span>
            <input
              type="number"
              min={0}
              className={`${cellInput} w-24`}
              value={newPrice}
              onChange={(e) => setNewPrice(Math.max(0, Number(e.target.value)))}
            />
          </label>
          <label className="text-sm">
            <span className="block font-medium text-gray-700">VAT %</span>
            <input
              type="number"
              min={0}
              max={100}
              step="0.1"
              className={`${cellInput} w-20`}
              value={newVat}
              onChange={(e) => setNewVat(Math.min(100, Math.max(0, Number(e.target.value))))}
            />
          </label>
          <button
            type="button"
            disabled={!newName.trim() || create.isPending}
            onClick={() =>
              create.mutate({
                name: newName.trim(),
                priceType: newType,
                price: Math.round(newPrice * 100),
                vatRate: Math.round(newVat * 100),
              })
            }
            className="rounded-md bg-[#000643] px-3 py-1.5 font-semibold text-white text-xs transition hover:opacity-90 disabled:opacity-40">
            {create.isPending ? "Adding…" : "Add add-on"}
          </button>
        </div>
      </div>

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
                <td className="px-3 py-2">
                  <input
                    type="text"
                    className={`${cellInput} w-44`}
                    value={r.name}
                    onChange={(e) => setField(r.id, "name", e.target.value)}
                  />
                  <input
                    type="text"
                    placeholder="Description"
                    className={`${cellInput} mt-1 w-44`}
                    value={r.description}
                    onChange={(e) => setField(r.id, "description", e.target.value)}
                  />
                </td>
                <td className="px-3 py-2">
                  <select
                    className={`${cellInput} w-32`}
                    value={r.priceType}
                    onChange={(e) => setField(r.id, "priceType", e.target.value)}>
                    {PRICE_TYPES.map((t) => (
                      <option key={t.value} value={t.value}>
                        {t.label}
                      </option>
                    ))}
                  </select>
                </td>
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
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => save(r)}
                      disabled={savingId === r.id}
                      className="rounded-md bg-[#000643] px-3 py-1 font-semibold text-white text-xs transition hover:opacity-90 disabled:opacity-40">
                      {savingId === r.id ? "Saving…" : "Save"}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        if (window.confirm(`Delete "${r.name}"? (Refused if used by bookings.)`)) {
                          remove.mutate({ id: r.id });
                        }
                      }}
                      className="rounded-md border border-red-200 px-2 py-1 font-medium text-red-600 text-xs transition hover:border-red-400">
                      Delete
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {error ? <p className="mt-3 text-red-600 text-sm">{error.message}</p> : null}
    </div>
  );
}
