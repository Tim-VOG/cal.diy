import { describe, expect, it } from "vitest";
import { planExtension } from "./bookingExtension";

/** Event-local hour on 17 Nov; Istanbul is UTC+3 all year. */
function at(localHour: number, minute = 0): Date {
  return new Date(
    `2026-11-17T${String(localHour - 3).padStart(2, "0")}:${String(minute).padStart(2, "0")}:00.000Z`
  );
}

/** Quarter-hour marks from 09:00 to 18:00 event-local, like a real event day. */
const OPEN = new Set<number>();
for (let ms = at(9).getTime(); ms < at(18).getTime(); ms += 15 * 60 * 1000) OPEN.add(ms);

const parent = { uid: "parent-uid", startTime: at(11), endTime: at(13) };

describe("planExtension", () => {
  describe("running later", () => {
    const plan = planExtension({
      parent,
      direction: "after",
      durationHours: 1,
      bufferMinutes: 15,
      openSlotMs: OPEN,
    });

    it("starts exactly where the meeting ends", () => {
      expect(plan.startTime.toISOString()).toBe(at(13).toISOString());
      expect(plan.endTime.toISOString()).toBe(at(14).toISOString());
    });

    it("leaves the meeting's gap exactly where it is and starts after it", () => {
      // 13:00-13:15 stays the meeting's own cleaning gap. Claiming it would
      // collide with the row that is already there — and releasing it would
      // leave the paid meeting with no gap the moment this continuation went
      // away.
      expect(plan.slotStarts[0].toISOString()).toBe(at(13, 15).toISOString());
      expect(plan.slotStarts.map((d) => d.toISOString())).not.toContain(at(13).toISOString());
    });

    it("still begins, for the exhibitor, where the meeting ended", () => {
      // What is sold, shown and invoiced is the full hour from 13:00. Only the
      // slot bookkeeping starts later.
      expect(plan.startTime.toISOString()).toBe(at(13).toISOString());
      expect(plan.durationMinutes).toBe(60);
    });

    it("covers the room end to end between the two bookings", () => {
      // The meeting's gap rows cover 13:00-13:15 and these cover the rest, so
      // there is no quarter-hour in between that anyone else could take.
      const covered = plan.slotStarts.map((d) => d.getTime());
      for (let ms = at(13, 15).getTime(); ms < at(14).getTime(); ms += 15 * 60 * 1000) {
        expect(covered).toContain(ms);
      }
    });

    it("reserves a fresh gap after the new end", () => {
      expect(plan.bufferSlots.map((d) => d.toISOString())).toEqual([at(14).toISOString()]);
    });

    it("leaves fifteen free minutes after the run, as before", () => {
      const lastHeld = [...plan.slotStarts, ...plan.bufferSlots].map((d) => d.getTime()).sort();
      expect(new Date(lastHeld[lastHeld.length - 1]).toISOString()).toBe(at(14).toISOString());
    });
  });

  describe("starting earlier", () => {
    const plan = planExtension({
      parent,
      direction: "before",
      durationHours: 2,
      bufferMinutes: 15,
      openSlotMs: OPEN,
    });

    it("ends exactly where the meeting begins", () => {
      expect(plan.startTime.toISOString()).toBe(at(9).toISOString());
      expect(plan.endTime.toISOString()).toBe(at(11).toISOString());
    });

    it("reserves no gap of its own", () => {
      // What follows is the exhibitor's own meeting. A trailing gap here would
      // land on the parent's first slot and refuse the booking it continues.
      expect(plan.bufferSlots).toEqual([]);
    });

    it("claims every quarter-hour it occupies", () => {
      // Nothing of the parent's covers this side, so the continuation holds its
      // whole range itself.
      expect(plan.slotStarts).toHaveLength(8);
      expect(plan.slotStarts[0].toISOString()).toBe(at(9).toISOString());
    });
  });

  it("refuses to run past closing", () => {
    expect(() =>
      planExtension({
        parent: { uid: "p", startTime: at(15), endTime: at(17) },
        direction: "after",
        durationHours: 2,
        bufferMinutes: 15,
        openSlotMs: OPEN,
      })
    ).toThrow(/opening hours/i);
  });

  it("refuses to start before opening", () => {
    expect(() =>
      planExtension({
        parent: { uid: "p", startTime: at(10), endTime: at(12) },
        direction: "before",
        durationHours: 2,
        bufferMinutes: 15,
        openSlotMs: OPEN,
      })
    ).toThrow(/opening hours/i);
  });

  it("claims its first quarter-hour when the gap is switched off", () => {
    // With no gap there is nothing of the parent's in the way, so the
    // continuation holds its range from the first minute.
    const plan = planExtension({
      parent,
      direction: "after",
      durationHours: 1,
      bufferMinutes: 0,
      openSlotMs: OPEN,
    });
    expect(plan.bufferSlots).toEqual([]);
    expect(plan.slotStarts[0].toISOString()).toBe(at(13).toISOString());
    expect(plan.slotStarts).toHaveLength(4);
  });

  it("never claims a quarter-hour the meeting's gap already holds", () => {
    // The property that matters, at every gap length an admin can set: the
    // continuation and the meeting can never both want the same row.
    for (const bufferMinutes of [0, 15, 30, 45, 60]) {
      const plan = planExtension({
        parent,
        direction: "after",
        durationHours: 2,
        bufferMinutes,
        openSlotMs: OPEN,
      });
      const gapRows: number[] = [];
      for (let i = 0; i < bufferMinutes / 15; i++) {
        gapRows.push(at(13).getTime() + i * 15 * 60 * 1000);
      }
      for (const row of gapRows) {
        expect(plan.slotStarts.map((d) => d.getTime())).not.toContain(row);
      }
    }
  });
});
