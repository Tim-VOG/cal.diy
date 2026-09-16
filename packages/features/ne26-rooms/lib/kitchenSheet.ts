/**
 * What the caterer has to prepare, per event day: each add-on, how many
 * portions are confirmed, how many are still on a hold that may vanish, and
 * where and when each delivery goes.
 *
 * The add-ons page only listed the catalogue — prices and switches — so the
 * question the caterer actually asks ("how many lunches on Wednesday, to which
 * rooms, for when?") meant reading every booking. Released bookings are left
 * out: nobody cooks for a cancelled room.
 */

import { type EventDaySchedule, SLOT_GRANULARITY_MS } from "./eventSchedule";

export interface KitchenBooking {
  uid: string;
  roomName: string;
  status: string;
  startUtc: string;
  endUtc: string;
  addOns: { name: string; quantity: number }[];
}

export interface KitchenDelivery {
  bookingUid: string;
  roomName: string;
  startUtc: string;
  endUtc: string;
  quantity: number;
  held: boolean;
}

export interface KitchenItem {
  name: string;
  confirmed: number;
  held: number;
  deliveries: KitchenDelivery[];
}

export interface KitchenDay {
  date: string;
  openUtc: string;
  items: KitchenItem[];
}

export function kitchenSheet(input: {
  schedule: readonly EventDaySchedule[];
  bookings: KitchenBooking[];
  /** Catalogue order, so the sheet reads the same way every day. */
  addOnOrder: string[];
}): KitchenDay[] {
  const rank = new Map(input.addOnOrder.map((name, i) => [name, i]));

  return input.schedule.map((day) => {
    const starts = day.openSlotStartsUtc.map((d) => d.getTime());
    const open = starts[0] ?? 0;
    const close = starts.length ? starts[starts.length - 1] + SLOT_GRANULARITY_MS : open;
    const items = new Map<string, KitchenItem>();

    for (const b of input.bookings) {
      if (b.status !== "CONFIRMED" && b.status !== "PENDING") continue;
      const start = new Date(b.startUtc).getTime();
      // A booking belongs to the day it starts in.
      if (start < open || start >= close) continue;
      const held = b.status === "PENDING";
      for (const a of b.addOns) {
        if (a.quantity <= 0) continue;
        const item = items.get(a.name) ?? { name: a.name, confirmed: 0, held: 0, deliveries: [] };
        if (held) item.held += a.quantity;
        else item.confirmed += a.quantity;
        item.deliveries.push({
          bookingUid: b.uid,
          roomName: b.roomName,
          startUtc: b.startUtc,
          endUtc: b.endUtc,
          quantity: a.quantity,
          held,
        });
        items.set(a.name, item);
      }
    }

    const sorted = Array.from(items.values()).sort(
      (x, y) => (rank.get(x.name) ?? 999) - (rank.get(y.name) ?? 999) || x.name.localeCompare(y.name)
    );
    for (const item of sorted) item.deliveries.sort((x, y) => x.startUtc.localeCompare(y.startUtc));
    return { date: day.date, openUtc: new Date(open).toISOString(), items: sorted };
  });
}
