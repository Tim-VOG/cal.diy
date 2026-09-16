import { describe, expect, it } from "vitest";
import { type PlanBooking, planLayout } from "./planLayout";

// Wednesday 18 Nov, open 09:00-17:00 Istanbul = 06:00-14:00 UTC: 480 minutes.
const OPEN = new Date("2026-11-18T06:00:00.000Z");
const CLOSE = new Date("2026-11-18T14:00:00.000Z");

/** Local Istanbul time on Wednesday as an ISO instant. */
const at = (h: number, m = 0) => new Date(Date.UTC(2026, 10, 18, h - 3, m)).toISOString();

let n = 0;
const booking = (roomName: string, from: string, to: string, status = "CONFIRMED"): PlanBooking => ({
  uid: `b${n++}`,
  roomName,
  status,
  startUtc: from,
  endUtc: to,
});

const layout = (bookings: PlanBooking[], rooms = ["Suite 1"], bufferMinutes = 15) =>
  planLayout({ bookings, roomNames: rooms, openUtc: OPEN, closeUtc: CLOSE, bufferMinutes });

describe("planLayout", () => {
  it("draws a booking that starts between hours, where the old calendar drew nothing", () => {
    // 10:15 is the second start of every chained day. Hidden, the room read as
    // free to the desk while it was sold.
    const [row] = layout([booking("Suite 1", at(10, 15), at(12, 15))]);
    expect(row.blocks).toHaveLength(1);
    expect(row.blocks[0].left).toBeCloseTo((75 / 480) * 100);
    expect(row.blocks[0].width).toBeCloseTo((120 / 480) * 100);
  });

  it("draws every booking of a fully chained day", () => {
    const day = [
      booking("Suite 1", at(9), at(10)),
      booking("Suite 1", at(10, 15), at(11, 15)),
      booking("Suite 1", at(11, 30), at(12, 30)),
      booking("Suite 1", at(12, 45), at(13, 45)),
    ];
    expect(layout(day)[0].blocks.map((b) => b.booking.uid)).toEqual(day.map((b) => b.uid));
  });

  it("shows the cleaning gap after a booking, and none at closing time", () => {
    const [row] = layout([booking("Suite 1", at(9), at(10)), booking("Suite 1", at(16), at(17))]);
    expect(row.blocks[0].cleaningWidth).toBeCloseTo((15 / 480) * 100);
    expect(row.blocks[1].cleaningWidth).toBe(0);
  });

  it("does not let a cancelled booking hide the live one that replaced it", () => {
    // Same room, same start: the old calendar keyed both by room + start.
    const cancelled = booking("Suite 1", at(14), at(15), "CANCELLED");
    const live = booking("Suite 1", at(14), at(15), "CONFIRMED");
    const blocks = layout([live, cancelled])[0].blocks;
    expect(blocks.map((b) => b.booking.uid)).toEqual([live.uid]);
    expect(blocks[0].conflict).toBe(false);
  });

  it("draws a live hold", () => {
    const hold = booking("Suite 1", at(11, 30), at(13, 30), "PENDING");
    expect(layout([hold])[0].blocks[0].booking.uid).toBe(hold.uid);
  });

  it("puts each booking in its own room only", () => {
    const rows = layout(
      [booking("Suite 1", at(9), at(10)), booking("Small Room 2", at(9), at(11))],
      ["Suite 1", "Small Room 2", "Large Room 1"]
    );
    expect(rows.map((r) => r.blocks.length)).toEqual([1, 1, 0]);
  });

  it("ignores another day's bookings", () => {
    expect(
      layout([booking("Suite 1", "2026-11-17T06:00:00.000Z", "2026-11-17T07:00:00.000Z")])[0].blocks
    ).toEqual([]);
  });

  it("flags two live bookings that overlap instead of stacking them silently", () => {
    // Should be impossible under the unique slot index. If it ever happens, the
    // plan is where someone will notice.
    const blocks = layout([booking("Suite 1", at(9), at(11)), booking("Suite 1", at(10), at(12))])[0].blocks;
    expect(blocks.every((b) => b.conflict)).toBe(true);
  });

  it("does not call back-to-back bookings a conflict", () => {
    const blocks = layout([booking("Suite 1", at(9), at(10)), booking("Suite 1", at(10), at(11))])[0].blocks;
    expect(blocks.some((b) => b.conflict)).toBe(false);
  });

  it("cuts a booking to the opening window and says so", () => {
    const [block] = layout([booking("Suite 1", at(16), at(18))])[0].blocks;
    expect(block.left + block.width).toBeCloseTo(100);
    expect(block.clipped).toBe(true);
  });
});
