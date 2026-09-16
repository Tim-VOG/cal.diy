import { describe, expect, it } from "vitest";
import { type DayStatsBooking, dayStats } from "./dayStats";
import { buildEventSchedule } from "./eventSchedule";

const SCHEDULE = buildEventSchedule([
  { date: "2026-11-17", openHour: 9, closeHour: 17 },
  { date: "2026-11-19", openHour: 9, closeHour: 11 },
]);
const ROOMS = ["Suite 1", "Small Room 2"];
/** Istanbul local time as an ISO instant. */
const at = (date: string, h: number, m = 0) => {
  const [y, mo, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, mo - 1, d, h - 3, m)).toISOString();
};
const b = (over: Partial<DayStatsBooking>): DayStatsBooking => ({
  roomName: "Suite 1",
  status: "CONFIRMED",
  startUtc: at("2026-11-17", 9),
  endUtc: at("2026-11-17", 10),
  amountTotal: 72000,
  addOns: [],
  ...over,
});

const run = (
  bookings: DayStatsBooking[],
  blocks: { roomName: string; startUtc: string; endUtc: string }[] = []
) => dayStats({ schedule: SCHEDULE, roomNames: ROOMS, bookings, blocks });

describe("dayStats", () => {
  it("derives capacity from the rooms and the configured hours", () => {
    const [tue, thu] = run([]);
    expect(tue.capacityHours).toBe(16); // 2 rooms × 8 h
    expect(thu.capacityHours).toBe(4); // 2 rooms × 2 h
    expect(tue.grid.map((r) => r.cells.length)).toEqual([8, 8]);
  });

  it("counts sold, held and blocked hours separately", () => {
    const [tue] = run(
      [
        b({ startUtc: at("2026-11-17", 10, 15), endUtc: at("2026-11-17", 12, 15) }),
        b({
          status: "PENDING",
          roomName: "Small Room 2",
          startUtc: at("2026-11-17", 9),
          endUtc: at("2026-11-17", 10),
        }),
        b({ status: "CANCELLED", startUtc: at("2026-11-17", 14), endUtc: at("2026-11-17", 15) }),
      ],
      [{ roomName: "Small Room 2", startUtc: at("2026-11-17", 15), endUtc: at("2026-11-17", 17) }]
    );
    expect(tue).toMatchObject({ soldHours: 2, heldHours: 1, blockedHours: 2, confirmedRevenue: 72000 });
  });

  it("marks every hour a chained booking touches", () => {
    // 10:15-12:15 touches the 10, 11 and 12 o'clock cells.
    const [tue] = run([b({ startUtc: at("2026-11-17", 10, 15), endUtc: at("2026-11-17", 12, 15) })]);
    expect(tue.grid[0].cells).toEqual(["free", "sold", "sold", "sold", "free", "free", "free", "free"]);
  });

  it("draws a booking as one span to the minute, not as the cells it touches", () => {
    // A one-hour booking at 10:15 touched two cells and read as two hours sold.
    const [tue] = run([b({ startUtc: at("2026-11-17", 10, 15), endUtc: at("2026-11-17", 11, 15) })]);
    expect(tue.grid[0].spans).toEqual([{ from: 1.25 / 8, to: 2.25 / 8, state: "sold" }]);
    expect(tue.grid[1].spans).toEqual([]);
  });

  it("lets a sale outrank a hold or a block in the same cell", () => {
    const [tue] = run(
      [
        b({ status: "PENDING", startUtc: at("2026-11-17", 9), endUtc: at("2026-11-17", 9, 30) }),
        b({ startUtc: at("2026-11-17", 9, 30), endUtc: at("2026-11-17", 10) }),
      ],
      [{ roomName: "Suite 1", startUtc: at("2026-11-17", 9), endUtc: at("2026-11-17", 10) }]
    );
    expect(tue.grid[0].cells[0]).toBe("sold");
  });

  it("tells the kitchen what is confirmed and what may still vanish", () => {
    const [tue] = run([
      b({ addOns: [{ name: "Lunch", quantity: 12 }] }),
      b({ roomName: "Small Room 2", addOns: [{ name: "Lunch", quantity: 6 }] }),
      b({
        status: "PENDING",
        roomName: "Small Room 2",
        startUtc: at("2026-11-17", 12),
        endUtc: at("2026-11-17", 13),
        addOns: [{ name: "Lunch", quantity: 6 }],
      }),
      b({ status: "CANCELLED", addOns: [{ name: "Breakfast", quantity: 12 }] }),
    ]);
    expect(tue.catering).toEqual([{ name: "Lunch", confirmed: 18, held: 6 }]);
  });

  it("files a booking under its own day only", () => {
    const [tue, thu] = run([b({ startUtc: at("2026-11-19", 9), endUtc: at("2026-11-19", 10) })]);
    expect(tue.soldHours).toBe(0);
    expect(thu.soldHours).toBe(1);
  });

  it("ignores a booking on a room no longer on sale", () => {
    const [tue] = run([b({ roomName: "Withdrawn Room" })]);
    expect(tue.soldHours).toBe(0);
    expect(tue.confirmedRevenue).toBe(0);
  });

  it("gives each room its own hours, to the minute", () => {
    const [tue] = run(
      [
        b({ startUtc: at("2026-11-17", 10, 15), endUtc: at("2026-11-17", 11, 45) }),
        b({
          status: "PENDING",
          roomName: "Small Room 2",
          startUtc: at("2026-11-17", 9),
          endUtc: at("2026-11-17", 10),
        }),
      ],
      [{ roomName: "Suite 1", startUtc: at("2026-11-17", 16), endUtc: at("2026-11-17", 17) }]
    );
    expect(tue.perRoom).toEqual([
      { roomName: "Suite 1", soldHours: 1.5, heldHours: 0, blockedHours: 1, capacityHours: 8 },
      { roomName: "Small Room 2", soldHours: 0, heldHours: 1, blockedHours: 0, capacityHours: 8 },
    ]);
  });
});
