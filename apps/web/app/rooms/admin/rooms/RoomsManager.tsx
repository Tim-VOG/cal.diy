"use client";

import type { EventDayDefinition } from "@calcom/features/ne26-rooms/lib/eventSchedule";
import { trpc } from "@calcom/trpc/react";
import { CalendarClock, Check, EyeOff, Ruler, Users } from "lucide-react";
import { useState } from "react";
import type { RoomIconName } from "@calcom/features/ne26-rooms/lib/roomIcons";
import { ROOM_ICON_CHOICE_GROUPS, roomIconFor } from "../../roomIcon";
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
  /** "" means: use the default for the category. */
  iconName: RoomIconName | "";
  isActive: boolean;
}

/**
 * The glyph shown for a room that has no photograph.
 *
 * Chosen rather than derived: the three category defaults were picked from the
 * price band, which is not what the room is for. Whoever sells the room knows
 * better, so they pick — and can go back to the default at any time.
 *
 * Collapsed until asked for. The catalogue runs to a hundred-odd glyphs, and
 * laying them all out inside a card that is now one of three across would bury
 * the prices under three screens of icons.
 */
function IconPicker({
  value,
  category,
  onChange,
}: {
  value: RoomIconName | "";
  category: string;
  onChange: (name: RoomIconName | "") => void;
}): JSX.Element {
  const [open, setOpen] = useState(false);
  const Current = roomIconFor(category, value || null);
  const cell =
    "flex aspect-square items-center justify-center rounded-lg border transition";
  const chosen = "border-[#000643] bg-[#000643]/5 text-[#000643]";
  const unchosen = "border-gray-200 text-gray-400 hover:border-[#000643]/40 hover:text-[#000643]";

  return (
    <div>
      <span className={label}>Icon (shown when there is no cover photo)</span>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="mt-1 flex w-full items-center gap-2 rounded-lg border border-gray-200 px-3 py-2 text-left transition hover:border-[#000643]/40">
        <Current className="h-5 w-5 shrink-0 text-[#000643]" strokeWidth={1.75} aria-hidden />
        <span className="min-w-0 flex-1 truncate text-gray-600 text-xs">
          {value === "" ? "Default for this category" : value}
        </span>
        <span className="shrink-0 font-medium text-[#000643] text-xs">
          {open ? "Close" : "Change"}
        </span>
      </button>

      {open ? (
        <div className="mt-2 max-h-72 overflow-y-auto rounded-lg border border-gray-200 p-2">
          <button
            type="button"
            onClick={() => onChange("")}
            className={`mb-2 flex w-full items-center gap-2 rounded-lg border px-2 py-1.5 text-xs transition ${
              value === "" ? chosen : unchosen
            }`}>
            <Current className="h-4 w-4 shrink-0" strokeWidth={1.75} aria-hidden />
            Default for this category
          </button>
          {ROOM_ICON_CHOICE_GROUPS.map((group) => (
            <div key={group.label} className="mb-2 last:mb-0">
              <p className="mb-1 font-medium text-gray-400 text-xs uppercase tracking-wide">
                {group.label}
              </p>
              <div className="grid grid-cols-6 gap-1 @md:grid-cols-8">
                {group.icons.map(({ name, Icon }) => (
                  <button
                    key={name}
                    type="button"
                    onClick={() => onChange(name)}
                    title={name}
                    aria-label={name}
                    aria-pressed={value === name}
                    className={`${cell} ${value === name ? chosen : unchosen}`}>
                    <Icon className="h-4.5 w-4.5" strokeWidth={1.75} aria-hidden />
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
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

/**
 * One room's editor.
 *
 * Declared at module scope on purpose. Nested inside RoomsManager it was a new
 * component type on every render, so React unmounted and remounted the whole
 * card on every keystroke and every save — losing the scroll position, losing
 * focus, and remounting the image pickers. What looked like "the page jumps to
 * the top" was the card being rebuilt from scratch.
 */
function RoomRowCard({
  r,
  savingId,
  savedId,
  setField,
  setGalleryImage,
  save,
  currency,
}: {
  r: RoomRow;
  savingId: number | null;
  savedId: number | null;
  setField: (id: number, field: keyof RoomRow, value: number | boolean | string) => void;
  setGalleryImage: (id: number, index: number, value: string) => void;
  save: (row: RoomRow) => void;
  currency: string;
}): JSX.Element {
  const d2 = discountPct(r.price1h, r.price2h, 2);
  const d3 = discountPct(r.price1h, r.price3h, 3);

  return (
    <div
      className={`@container rounded-xl border border-gray-200 p-5 transition ${
        r.isActive ? "bg-white" : "bg-gray-50/70"
      }`}>
      {/* Photos beside the fields only while the card is wide enough for both.
          The breakpoint is the CARD's width, not the screen's, so a card in a
          third of the display stacks instead of squeezing. */}
      <div className="grid grid-cols-1 gap-5 @3xl:grid-cols-[220px_1fr] @3xl:gap-6">
        <div>
          <ImagePicker
            label="Cover photo"
            value={r.imageUrl}
            onChange={(url) => setField(r.id, "imageUrl", url)}
          />
          <div className="mt-4">
            <span className={label}>Gallery</span>
            <div className="mt-1 grid grid-cols-2 gap-2">
              {[0, 1, 2, 3].map((i) => (
                <ImagePicker
                  key={i}
                  label={`Photo ${i + 1}`}
                  aspect="aspect-[3/2]"
                  value={r.galleryImages[i] ?? ""}
                  onChange={(url) => setGalleryImage(r.id, i, url)}
                />
              ))}
            </div>
          </div>
          <div className="mt-4">
            <IconPicker
              value={r.iconName}
              category={r.category}
              onChange={(name) => setField(r.id, "iconName", name)}
            />
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

          <div className="mt-4 grid max-w-xs grid-cols-2 gap-3">
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
          </div>

          <div className="mt-4 grid max-w-lg grid-cols-1 gap-3 @xs:grid-cols-3">
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

export default function RoomsManager({
  rooms,
  bufferMinutes,
  eventDays,
}: {
  rooms: RoomRow[];
  bufferMinutes: number;
  eventDays: EventDayDefinition[];
}): JSX.Element {
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
      // Deliberately no router.refresh(): the draft already holds exactly what
      // was just saved, and refreshing re-rendered the server tree underneath
      // the admin, moving the page while they were still working down it.
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
      iconName: row.iconName,
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
          <EventDaysForm initial={eventDays} bufferMinutes={bufferMinutes} />
        ) : (
          <>
            <p className="text-gray-600 text-sm">{CATEGORY_META[tab as Category].blurb}</p>
            <div className="mt-4 grid grid-cols-1 items-start gap-4 xl:grid-cols-2 min-[1800px]:grid-cols-3">
              {inTab.map((r) => (
                <RoomRowCard
                  key={r.id}
                  r={r}
                  savingId={savingId}
                  savedId={savedId}
                  setField={setField}
                  setGalleryImage={setGalleryImage}
                  save={save}
                  currency={currency}
                />
              ))}
            </div>
          </>
        )}
      </div>

      {update.error ? <p className="mt-4 text-red-600 text-sm">{update.error.message}</p> : null}
    </div>
  );
}
