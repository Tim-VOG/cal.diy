"use client";

import { EVENT_TIME_ZONE } from "@calcom/features/ne26-rooms/lib/eventSchedule";
import { List } from "lucide-react";
import { trpc } from "@calcom/trpc/react";
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
  /** Minutes from event-local midnight; null on both means all day. */
  availableFromMinute: number | null;
  availableToMinute: number | null;
}

/** "11:00" from 660, and back. The admin types a time, we store minutes. */
function toTimeValue(minute: number | null): string {
  if (minute == null) return "";
  return `${String(Math.floor(minute / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`;
}
function fromTimeValue(value: string): number | null {
  if (!value) return null;
  const [h, m] = value.split(":").map(Number);
  return Number.isFinite(h) && Number.isFinite(m) ? h * 60 + m : null;
}

const PRICE_TYPES = [
  { value: "FLAT", label: "Flat" },
  { value: "PER_PERSON", label: "Per person" },
  { value: "PER_HOUR", label: "Per hour" },
] as const;
type PriceType = (typeof PRICE_TYPES)[number]["value"];

const input =
  "mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-[#000643] focus:outline-none";
const label = "block font-medium text-gray-500 text-xs";

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

  function setField(
    id: number,
    field: keyof AddOnRow,
    value: number | boolean | string | null
  ): void {
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
      availableFromMinute: row.availableFromMinute,
      availableToMinute: row.availableToMinute,
    });
  }

  const error = update.error ?? remove.error ?? create.error;

  return (
    <div>
      <h1 className="font-bold text-2xl text-[#000643]">Manage add-ons</h1>
      <p className="mt-1 text-gray-600 text-sm">Create, edit or remove add-ons. Prices are excl. VAT.</p>

      {/* Create */}
      <div className="mt-5 rounded-xl border border-gray-200 bg-white p-5">
        <h2 className="font-semibold text-[#000643] text-xs uppercase tracking-wide">New add-on</h2>
        <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <label>
            <span className={label}>Name</span>
            <input
              type="text"
              className={input}
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
            />
          </label>
          <label>
            <span className={label}>Pricing</span>
            <select
              className={input}
              value={newType}
              onChange={(e) => setNewType(e.target.value as PriceType)}>
              {PRICE_TYPES.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span className={label}>Price (excl. VAT)</span>
            <input
              type="number"
              min={0}
              className={input}
              value={newPrice}
              onChange={(e) => setNewPrice(Math.max(0, Number(e.target.value)))}
            />
          </label>
          <label>
            <span className={label}>VAT %</span>
            <input
              type="number"
              min={0}
              max={100}
              step="0.1"
              className={input}
              value={newVat}
              onChange={(e) => setNewVat(Math.min(100, Math.max(0, Number(e.target.value))))}
            />
          </label>
        </div>
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
          className="mt-3 rounded-lg bg-[#000643] px-4 py-2 font-semibold text-sm text-white transition hover:opacity-90 disabled:opacity-40">
          {create.isPending ? "Adding…" : "Add add-on"}
        </button>
      </div>

      {/* Add-on cards */}
      {/* One per row rather than three across: the fields were squeezed into a
          third of the screen, so "Pricing", "Price" and "VAT %" wrapped to
          different heights and the caterer's description was a two-line
          window onto a ten-line text. */}
      <div className="mt-6 grid grid-cols-1 items-start gap-4 2xl:grid-cols-2">
        {draft.map((r) => (
          <div key={r.id} className="rounded-xl border border-gray-200 bg-white p-5">
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

            <div className="mt-3 grid grid-cols-2 items-end gap-3 sm:grid-cols-3 lg:grid-cols-5">
              <label>
                <span className={label}>Pricing</span>
                <select
                  className={input}
                  value={r.priceType}
                  onChange={(e) => setField(r.id, "priceType", e.target.value)}>
                  {PRICE_TYPES.map((t) => (
                    <option key={t.value} value={t.value}>
                      {t.label}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <span className={label}>Price ({r.currency})</span>
                <input
                  type="number"
                  min={0}
                  className={input}
                  value={Math.round(r.price) / 100}
                  onChange={(e) =>
                    setField(r.id, "price", Math.round(Math.max(0, Number(e.target.value)) * 100))
                  }
                />
              </label>
              <label>
                <span className={label}>VAT %</span>
                <input
                  type="number"
                  min={0}
                  max={100}
                  step="0.1"
                  className={input}
                  value={r.vatRate / 100}
                  onChange={(e) =>
                    setField(
                      r.id,
                      "vatRate",
                      Math.round(Math.min(100, Math.max(0, Number(e.target.value))) * 100)
                    )
                  }
                />
              </label>
              <label>
                <span className={label}>Served from</span>
                <input
                  type="time"
                  className={input}
                  value={toTimeValue(r.availableFromMinute)}
                  onChange={(e) => setField(r.id, "availableFromMinute", fromTimeValue(e.target.value))}
                />
              </label>
              <label>
                <span className={label}>Served until</span>
                <input
                  type="time"
                  className={input}
                  value={toTimeValue(r.availableToMinute)}
                  onChange={(e) => setField(r.id, "availableToMinute", fromTimeValue(e.target.value))}
                />
              </label>
            </div>
            <p className="mt-1.5 text-gray-400 text-xs">
              {r.availableFromMinute != null && r.availableToMinute != null
                ? `Offered only to bookings that run between these hours (${EVENT_TIME_ZONE}). Clear both to sell it all day.`
                : `Available all day. Set both to limit it to serving hours (${EVENT_TIME_ZONE}) — a 09:00 booking should not be offered lunch.`}
            </p>

            <label className="mt-3 block">
              <span className={label}>Description</span>
              <textarea
                rows={7}
                className={`${input} font-mono text-xs leading-relaxed`}
                value={r.description}
                onChange={(e) => setField(r.id, "description", e.target.value)}
              />
            </label>
            <div className="mt-1.5 flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() =>
                  setField(
                    r.id,
                    "description",
                    `${r.description.replace(/\s*$/, "")}\n- `.replace(/^\n/, "")
                  )
                }
                className="rounded-md border border-gray-200 px-2 py-1 font-medium text-[#000643] text-xs transition hover:border-[#000643]">
                <List className="mr-1 inline h-3 w-3" aria-hidden />
                Add a bullet
              </button>
              {/* The formatting is deliberately two rules rather than an editor:
                  anything richer would mean storing HTML from the admin and
                  rendering it on the public page. */}
              <p className="text-gray-400 text-xs">
                A line starting with <code className="text-gray-500">-</code> becomes a bullet.
                Everything else is a paragraph. Blank lines are ignored.
              </p>
            </div>

            <div className="mt-4 flex gap-2">
              <button
                type="button"
                onClick={() => save(r)}
                disabled={savingId === r.id}
                className="rounded-lg bg-[#000643] px-4 py-2 font-semibold text-sm text-white transition hover:opacity-90 disabled:opacity-40">
                {savingId === r.id ? "Saving…" : "Save"}
              </button>
              <button
                type="button"
                onClick={() => {
                  if (window.confirm(`Delete "${r.name}"? (Refused if used by bookings.)`)) {
                    remove.mutate({ id: r.id });
                  }
                }}
                className="rounded-lg border border-red-200 px-3 py-2 font-medium text-red-600 text-sm transition hover:border-red-400">
                Delete
              </button>
            </div>
          </div>
        ))}
      </div>

      {error ? <p className="mt-3 text-red-600 text-sm">{error.message}</p> : null}
    </div>
  );
}
