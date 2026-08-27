/**
 * What an exhibitor was considering, per room, kept across navigation.
 *
 * Picking a slot and ticking add-ons is real work, and leaving the page to
 * compare another room threw all of it away. This keeps the selection so coming
 * back restores it, and so the listing can show what has been lined up so far.
 *
 * sessionStorage, not localStorage, deliberately: a saved selection holds a
 * price and a slot, and both go stale. Tying it to the tab means it cannot
 * resurface days later next to a room that has since been sold or repriced.
 * Nothing here is authoritative — the server recomputes the price and re-checks
 * availability when the booking is actually created.
 */

const KEY = "ne26-rooms.selections.v1";

/** Selections older than this are dropped on read, even within the tab. */
const MAX_AGE_MS = 6 * 60 * 60 * 1000;

export interface RoomSelection {
  slug: string;
  roomName: string;
  /** ISO date of the chosen day, e.g. "2026-11-17". */
  date: string;
  startUtc: string | null;
  durationHours: number;
  addOns: Record<string, number>;
  /** Total excl. VAT as displayed when it was saved — for recall only. */
  total: number;
  currency: string;
  savedAt: number;
}

type Store = Record<string, RoomSelection>;

function isSelection(value: unknown): value is RoomSelection {
  if (!value || typeof value !== "object") return false;
  const s = value as Partial<RoomSelection>;
  return (
    typeof s.slug === "string" &&
    typeof s.roomName === "string" &&
    typeof s.date === "string" &&
    typeof s.durationHours === "number" &&
    typeof s.total === "number" &&
    typeof s.currency === "string" &&
    typeof s.savedAt === "number" &&
    Boolean(s.addOns) &&
    typeof s.addOns === "object"
  );
}

function read(now: number): Store {
  // Private browsing and storage-blocking extensions make sessionStorage throw
  // rather than return null, so every access is guarded: a browser that refuses
  // to remember must still be able to book.
  try {
    const raw = globalThis.sessionStorage?.getItem(KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return {};
    const store: Store = {};
    for (const [slug, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (isSelection(value) && now - value.savedAt < MAX_AGE_MS) store[slug] = value;
    }
    return store;
  } catch {
    return {};
  }
}

/**
 * Broadcast so the shortlist bar, which lives in the layout and never remounts
 * on client-side navigation, notices a change made on the page beneath it.
 * sessionStorage fires no `storage` event within its own tab, so without this
 * the bar would stay stale until a full reload.
 */
export const SELECTIONS_CHANGED = "ne26:selections-changed";

function write(store: Store): void {
  try {
    globalThis.sessionStorage?.setItem(KEY, JSON.stringify(store));
  } catch {
    // Storage full or unavailable — the selection simply is not remembered.
  }
  try {
    globalThis.dispatchEvent?.(new Event(SELECTIONS_CHANGED));
  } catch {
    // No window (server render, or a test environment without one).
  }
}

/** Every live selection, most recently saved first. */
export function listSelections(now: number = Date.now()): RoomSelection[] {
  return Object.values(read(now)).sort((a, b) => b.savedAt - a.savedAt);
}

export function getSelection(slug: string, now: number = Date.now()): RoomSelection | null {
  return read(now)[slug] ?? null;
}

/**
 * Remember a room's selection. A selection with no slot and no add-ons is not
 * worth keeping — it is just the page's default state — so it clears instead.
 */
export function saveSelection(selection: Omit<RoomSelection, "savedAt">, now: number = Date.now()): void {
  const store = read(now);
  const hasContent = Boolean(selection.startUtc) || Object.keys(selection.addOns).length > 0;
  if (!hasContent) {
    delete store[selection.slug];
  } else {
    store[selection.slug] = { ...selection, savedAt: now };
  }
  write(store);
}

export function clearSelection(slug: string, now: number = Date.now()): void {
  const store = read(now);
  delete store[slug];
  write(store);
}

export function clearAllSelections(): void {
  try {
    globalThis.sessionStorage?.removeItem(KEY);
  } catch {
    // Nothing to do — see write().
  }
}
