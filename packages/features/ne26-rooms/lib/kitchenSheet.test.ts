import { describe, expect, it } from "vitest";
import { buildEventSchedule } from "./eventSchedule";
import { type KitchenBooking, kitchenSheet } from "./kitchenSheet";

const SCHEDULE = buildEventSchedule([
  { date: "2026-11-17", openHour: 9, closeHour: 17 },
  { date: "2026-11-18", openHour: 9, closeHour: 17 },
]);
const at = (date: string, h: number, m = 0) => {
  const [y, mo, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, mo - 1, d, h - 3, m)).toISOString();
};
let n = 0;
const b = (over: Partial<KitchenBooking>): KitchenBooking => ({
  uid: `b${n++}`,
  roomName: "Suite 1",
  status: "CONFIRMED",
  startUtc: at("2026-11-17", 12),
  endUtc: at("2026-11-17", 14),
  addOns: [],
  ...over,
});
const run = (bookings: KitchenBooking[]) =>
  kitchenSheet({
    schedule: SCHEDULE,
    bookings,
    addOnOrder: ["Breakfast", "Lunch", "Non-Alcoholic Beverages"],
  });

describe("kitchenSheet", () => {
  it("adds up portions per add-on per day, with where and when each goes", () => {
    const [tue] = run([
      b({ roomName: "Suite 1", startUtc: at("2026-11-17", 12), addOns: [{ name: "Lunch", quantity: 12 }] }),
      b({
        roomName: "Small Room 2",
        startUtc: at("2026-11-17", 11, 30),
        addOns: [{ name: "Lunch", quantity: 6 }],
      }),
    ]);
    expect(tue.items).toHaveLength(1);
    expect(tue.items[0]).toMatchObject({ name: "Lunch", confirmed: 18, held: 0 });
    // In delivery order.
    expect(tue.items[0].deliveries.map((d) => d.roomName)).toEqual(["Small Room 2", "Suite 1"]);
  });

  it("keeps portions on a hold apart, because they may vanish", () => {
    const [tue] = run([
      b({ addOns: [{ name: "Lunch", quantity: 12 }] }),
      b({ status: "PENDING", roomName: "Large Room 1", addOns: [{ name: "Lunch", quantity: 12 }] }),
    ]);
    expect(tue.items[0]).toMatchObject({ confirmed: 12, held: 12 });
    expect(tue.items[0].deliveries.find((d) => d.roomName === "Large Room 1")?.held).toBe(true);
  });

  it("cooks nothing for a cancelled room", () => {
    const [tue] = run([b({ status: "CANCELLED", addOns: [{ name: "Lunch", quantity: 12 }] })]);
    expect(tue.items).toEqual([]);
  });

  it("files each booking under the day it starts", () => {
    const [tue, wed] = run([
      b({
        startUtc: at("2026-11-18", 9),
        endUtc: at("2026-11-18", 10),
        addOns: [{ name: "Breakfast", quantity: 6 }],
      }),
    ]);
    expect(tue.items).toEqual([]);
    expect(wed.items[0]).toMatchObject({ name: "Breakfast", confirmed: 6 });
  });

  it("lists add-ons in catalogue order, every day the same", () => {
    const [tue] = run([
      b({
        addOns: [
          { name: "Non-Alcoholic Beverages", quantity: 6 },
          { name: "Breakfast", quantity: 6 },
        ],
      }),
    ]);
    expect(tue.items.map((i) => i.name)).toEqual(["Breakfast", "Non-Alcoholic Beverages"]);
  });
});
