/**
 * The state of each event day, for the cards at the top of the bookings
 * dashboard: how much of the day is sold, what is still on hold, which hours
 * of which room are taken, and what the kitchen has to prepare.
 *
 * Capacity is computed from the rooms and the opening hours actually
 * configured, never a hard-coded total: close a room or move an opening hour
 * and the denominator follows.
 *
 * Pure: the page supplies the rows it already loaded.
 */

import { type EventDaySchedule, SLOT_GRANULARITY_MS } from "./eventSchedule";

const HOUR_MS = 60 * 60 * 1000;

export type CellState = "free" | "sold" | "held" | "blocked";

/** A stretch of a room's day, as fractions of the opening window (0 = open, 1 = close). */
export interface DaySpan {
  from: number;
  to: number;
  state: Exclude<CellState, "free">;
}

export interface DayStatsBooking {
  roomName: string;
  status: string;
  startUtc: string;
  endUtc: string;
  amountTotal: number;
  addOns: { name: string; quantity: number }[];
}

export interface DayStatsBlock {
  roomName: string;
  startUtc: string;
  endUtc: string;
}

export interface DayStats {
  date: string;
  openUtc: string;
  closeUtc: string;
  /** Rooms × opening hours. */
  capacityHours: number;
  soldHours: number;
  heldHours: number;
  blockedHours: number;
  /**
   * One row per room, one cell per opening hour — and the bookings themselves
   * as spans, to the minute. A 10:15–11:15 booking touches two hour cells, and
   * drawn as cells it read as two hours sold.
   */
  grid: { roomName: string; cells: CellState[]; spans: DaySpan[] }[];
  /** Hours per room, to the minute rather than rounded to the grid's cells. */
  perRoom: {
    roomName: string;
    soldHours: number;
    heldHours: number;
    blockedHours: number;
    capacityHours: number;
  }[];
  /** Portions to prepare, confirmed and still on hold, in first-seen order. */
  catering: { name: string; confirmed: number; held: number }[];
  /** Confirmed booking amounts starting that day, excl. VAT. */
  confirmedRevenue: number;
}

function overlapMs(aStart: number, aEnd: number, bStart: number, bEnd: number): number {
  return Math.max(0, Math.min(aEnd, bEnd) - Math.max(aStart, bStart));
}

/** A cell shows the strongest thing that touches it: sold, then held, then blocked. */
const STRENGTH: Record<CellState, number> = { free: 0, blocked: 1, held: 2, sold: 3 };

export function dayStats(input: {
  schedule: readonly EventDaySchedule[];
  roomNames: string[];
  bookings: DayStatsBooking[];
  blocks: DayStatsBlock[];
}): DayStats[] {
  return input.schedule.map((day) => {
    const starts = day.openSlotStartsUtc.map((d) => d.getTime());
    const open = starts[0] ?? 0;
    const close = starts.length ? starts[starts.length - 1] + SLOT_GRANULARITY_MS : open;
    const hoursInWindow = Math.round((close - open) / HOUR_MS);

    let soldMs = 0;
    let heldMs = 0;
    let blockedMs = 0;
    let confirmedRevenue = 0;
    const catering = new Map<string, { name: string; confirmed: number; held: number }>();

    const grid = input.roomNames.map((roomName) => ({
      roomName,
      cells: Array.from({ length: hoursInWindow }, () => "free" as CellState),
      spans: [] as DaySpan[],
    }));
    const rowOf = new Map(grid.map((row) => [row.roomName, row]));
    const roomMs = new Map(input.roomNames.map((name) => [name, { sold: 0, held: 0, blocked: 0 }]));

    const mark = (roomName: string, start: number, end: number, state: CellState) => {
      const row = rowOf.get(roomName);
      if (!row) return;
      const from = Math.max(start, open);
      const to = Math.min(end, close);
      if (state !== "free" && to > from) {
        row.spans.push({ from: (from - open) / (close - open), to: (to - open) / (close - open), state });
      }
      for (let h = 0; h < hoursInWindow; h++) {
        const cellStart = open + h * HOUR_MS;
        if (
          overlapMs(start, end, cellStart, cellStart + HOUR_MS) > 0 &&
          STRENGTH[state] > STRENGTH[row.cells[h]]
        ) {
          row.cells[h] = state;
        }
      }
    };

    for (const b of input.bookings) {
      const start = new Date(b.startUtc).getTime();
      const end = new Date(b.endUtc).getTime();
      const inDay = overlapMs(start, end, open, close);
      if (inDay === 0) continue;
      // Only rooms that are on sale count towards capacity, so only they count
      // towards what is sold — a booking on a room since withdrawn would
      // otherwise push a day past 100%.
      if (!rowOf.has(b.roomName)) continue;

      const perRoom = roomMs.get(b.roomName);
      if (b.status === "CONFIRMED") {
        soldMs += inDay;
        if (perRoom) perRoom.sold += inDay;
        confirmedRevenue += b.amountTotal;
        mark(b.roomName, start, end, "sold");
      } else if (b.status === "PENDING") {
        heldMs += inDay;
        if (perRoom) perRoom.held += inDay;
        mark(b.roomName, start, end, "held");
      } else {
        continue; // released: neither sold nor prepared for
      }

      for (const a of b.addOns) {
        const entry = catering.get(a.name) ?? { name: a.name, confirmed: 0, held: 0 };
        if (b.status === "CONFIRMED") entry.confirmed += a.quantity;
        else entry.held += a.quantity;
        catering.set(a.name, entry);
      }
    }

    for (const block of input.blocks) {
      const start = new Date(block.startUtc).getTime();
      const end = new Date(block.endUtc).getTime();
      const inDay = overlapMs(start, end, open, close);
      if (inDay === 0 || !rowOf.has(block.roomName)) continue;
      blockedMs += inDay;
      const perRoomBlocked = roomMs.get(block.roomName);
      if (perRoomBlocked) perRoomBlocked.blocked += inDay;
      mark(block.roomName, start, end, "blocked");
    }

    const round = (ms: number) => Math.round((ms / HOUR_MS) * 100) / 100;
    return {
      date: day.date,
      openUtc: new Date(open).toISOString(),
      closeUtc: new Date(close).toISOString(),
      capacityHours: hoursInWindow * input.roomNames.length,
      soldHours: round(soldMs),
      heldHours: round(heldMs),
      blockedHours: round(blockedMs),
      grid,
      perRoom: input.roomNames.map((roomName) => {
        const ms = roomMs.get(roomName) ?? { sold: 0, held: 0, blocked: 0 };
        return {
          roomName,
          soldHours: round(ms.sold),
          heldHours: round(ms.held),
          blockedHours: round(ms.blocked),
          capacityHours: hoursInWindow,
        };
      }),
      catering: Array.from(catering.values()),
      confirmedRevenue,
    };
  });
}
