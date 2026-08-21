"use client";

import type { EventDayDefinition } from "@calcom/features/ne26-rooms/lib/eventSchedule";
import { trpc } from "@calcom/trpc/react";
import { CalendarClock, Check, EyeOff, Ruler, Users } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import EventDaysForm from "./EventDaysForm";
import ImagePicker from "./ImagePicker";

const CATEGORIES = ["PREMIUM", "INTERMEDIATE", "ENTRY"] as const;
type Category = (typeof CATEGORIES)[number];

/** What each category is called on the price grid, rather than its database name. */
const CATEGORY_META: Record<Category, { title: string; blurb: string }> = {
  PREMIUM: { title: "Suites", blurb: "The largest rooms, sold with the permanent coffee break." },
  INTERMEDIATE: { title: "Large meeting rooms", blurb: "Screen and water included." },
  ENTRY: { title: "Small meeting rooms", blurb: "Screen and water included." },
};

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
  galleryImages: string[];
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

/**
 * The extended-use discount, as a percentage off the equivalent hourly rate.
 *
 * Shown while the prices are being typed in, because that is the number the
 * buyer sees — and the alternative is discovering on the public page that a
 * three-hour price implies −4% rather than the −15% that was intended.
 */
function discountPct(hourly: number, total: number, hours: number): number | null {
  if (hourly <= 0 || total <= 0) return null;
  const undiscounted = hourly * hours;
  if (total >= undiscounted) return null;
  return Math.round(((undiscounted - total) / undiscounted) * 100);
}

type Tab = "schedule" | Category;

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
  const [savedId, setSavedId] = useState<number | null>(null);
  // One section at a time. All nine rooms plus the schedule on a single page
  // meant scrolling past everything to reach anything.
  const [tab, setTab] = useState<Tab>("PREMIUM");

  const update = trpc.viewer.rooms.updateResource.useMutation({
    onSettled: () => setSavingId(null),
    onSuccess: (_data, variables) => {
      setSavedId(variables.id);
      router.refresh();
    },
  });

  function setField(id: number, field: keyof RoomRow, value: number | boolean | string): void {
    setDraft((rows) => rows.map((r) => (r.id === id ? { ...r, [field]: value } : r)));
    setSavedId(null);
  }

  function save(row: RoomRow): void {
    setSavingId(row.id);
    update.mutate({
      id: row.id,
      name: row.name,
      description: row.description,
      category: row.category as Category,
      capacity: row.capacity,
      surface: row.surface,
      price1h: row.price1h,
      price2h: row.price2h,
      price3h: row.price3h,
      imageUrl: row.imageUrl,
      galleryImages: row.galleryImages.map((s) => s.trim()).filter(Boolean),
      isActive: row.isActive,
    });
  }

  function setGalleryImage(id: number, index: number, value: string): void {
    setDraft((rows) =>
      rows.map((r) => {
        if (r.id !== id) return r;
        const gallery = [...r.galleryImages];
        while (gallery.length < 4) gallery.push("");
        gallery[index] = value;
        return { ...r, galleryImages: gallery };
      })
    );
    setSavedId(null);
  }

  const currency = draft[0]?.currency ?? "EUR";

  /**
   * One room per full-width row: photos on the left, everything editable on the
   * right. Tall cards side by side meant the fields were narrow and the photos
   * were thumbnails — neither of which is what you need when checking a room
   * against the price grid.
   */
  function RoomRowCard({ r }: { r: RoomRow }): JSX.Element {
    const d2 = discountPct(r.price1h, r.price2h, 2);
    const d3 = discountPct(r.price1h, r.price3h, 3);

    return (
      <div
        className={`rounded-xl border border-gray-200 p-5 transition ${
          r.isActive ? "bg-white" : "bg-gray-50/70"
        }`}>
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-[260px_1fr]">
          <div>
            <ImagePicker
              label="Cover photo"
              value={r.imageUrl}
              onChange={(url) => setField(r.id, "imageUrl", url)}
            />
            <div className="mt-3 grid grid-cols-4 gap-2">
              {[0, 1, 2, 3].map((i) => (
                <ImagePicker
                  key={i}
                  label={`${i + 1}`}
                  aspect="aspect-square"
                  value={r.galleryImages[i] ?? ""}
                  onChange={(url) => setGalleryImage(r.id, i, url)}
                />
              ))}
            </div>
          </div>

          <div>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <input
                type="text"
                aria-label="Room name"
                className={`${input} mt-0 max-w-sm flex-1 font-semibold text-[#000643] text-base`}
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
                {r.isActive ? (
                  "On sale"
                ) : (
                  <span className="flex items-center gap-1">
                    <EyeOff className="h-3 w-3 shrink-0" aria-hidden />
                    Hidden
                  </span>
                )}
              </label>
            </div>

            <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-5">
              <label>
                <span className={`${label} flex items-center gap-1`}>
                  <Users className="h-3 w-3 shrink-0" aria-hidden />
                  Capacity
                </span>
                <input
                  type="number"
                  min={0}
                  className={input}
                  value={r.capacity}
                  onChange={(e) => setField(r.id, "capacity", Math.max(0, Number(e.target.value)))}
                />
              </label>
              <label>
                <span className={`${label} flex items-center gap-1`}>
                  <Ruler className="h-3 w-3 shrink-0" aria-hidden />
                  m²
                </span>
                <input
                  type="number"
                  min={0}
                  className={input}
                  value={r.surface}
                  onChange={(e) => setField(r.id, "surface", Math.max(0, Number(e.target.value)))}
                />
              </label>
              {(
                [
                  ["price1h", "1h", null],
                  ["price2h", "2h", d2],
                  ["price3h", "3h", d3],
                ] as const
              ).map(([key, text, pct]) => (
                <label key={key}>
                  <span className={label}>
                    {text} ({currency})
                    {pct ? <span className="ml-1 font-medium text-green-700">−{pct}%</span> : null}
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
            <p className="mt-1 text-gray-400 text-xs">
              Prices excl. VAT. The discount buyers see is worked out from them, not set separately.
            </p>

            <label className="mt-4 block">
              <span className={label}>Description</span>
              <textarea
                rows={3}
                className={input}
                value={r.description}
                onChange={(e) => setField(r.id, "description", e.target.value)}
              />
            </label>

            <div className="mt-4 flex items-center gap-3">
              <button
                type="button"
                onClick={() => save(r)}
                disabled={savingId === r.id}
                className="rounded-lg bg-[#000643] px-4 py-2 font-semibold text-sm text-white transition hover:opacity-90 disabled:opacity-40">
                {savingId === r.id ? "Saving…" : "Save room"}
              </button>
              {savedId === r.id ? (
                <span className="flex items-center gap-1 text-green-600 text-sm">
                  <Check className="h-4 w-4" aria-hidden />
                  Saved
                </span>
              ) : null}
            </div>
          </div>
        </div>
      </div>
    );
  }

  const tabs: { key: Tab; label: string; count?: number }[] = [
    { key: "schedule", label: "Schedule" },
    ...CATEGORIES.map((c) => ({
      key: c as Tab,
      label: CATEGORY_META[c].title,
      count: draft.filter((r) => r.category === c).length,
    })).filter((t) => (t.count ?? 0) > 0),
  ];

  const inTab = tab === "schedule" ? [] : draft.filter((r) => r.category === tab);

  return (
    <div>
      <h1 className="font-bold text-2xl text-[#000643]">Rooms</h1>
      <p className="mt-1 text-gray-600 text-sm">
        Prices are excl. VAT, in {currency}. What a buyer pays on top is worked out at checkout from their
        country and VAT number.
      </p>

      <nav className="mt-5 flex flex-wrap gap-1 border-gray-200 border-b">
        {tabs.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setTab(t.key)}
            className={`-mb-px flex items-center gap-2 border-b-2 px-4 py-2 font-medium text-sm transition ${
              tab === t.key
                ? "border-[#000643] text-[#000643]"
                : "border-transparent text-gray-500 hover:text-[#000643]"
            }`}>
            {t.key === "schedule" ? <CalendarClock className="h-4 w-4 shrink-0" aria-hidden /> : null}
            {t.label}
            {t.count ? <span className="text-gray-400 text-xs">{t.count}</span> : null}
          </button>
        ))}
      </nav>

      <div className="mt-5">
        {tab === "schedule" ? (
          <EventDaysForm
            initial={eventDays}
            bufferMinutes={bufferMinutes}
            slotGranularityMinutes={slotGranularityMinutes}
          />
        ) : (
          <>
            <p className="text-gray-600 text-sm">{CATEGORY_META[tab as Category].blurb}</p>
            <div className="mt-4 space-y-4">
              {inTab.map((r) => (
                <RoomRowCard key={r.id} r={r} />
              ))}
            </div>
          </>
        )}
      </div>

      {update.error ? <p className="mt-4 text-red-600 text-sm">{update.error.message}</p> : null}
    </div>
  );
}
