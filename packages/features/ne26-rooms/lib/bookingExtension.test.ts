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

    it("takes over the gap the meeting was holding", () => {
      expect(plan.releasesParentBufferFrom?.toISOString()).toBe(at(13).toISOString());
      // Which is also the extension's first slot: without the hand-over the
      // insert would collide with the parent's own buffer row.
      expect(plan.slotStarts[0].toISOString()).toBe(at(13).toISOString());
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

    it("leaves the meeting's own gap alone", () => {
      expect(plan.releasesParentBufferFrom).toBeNull();
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

  it("holds the whole run when the gap is switched off", () => {
    const plan = planExtension({
      parent,
      direction: "after",
      durationHours: 1,
      bufferMinutes: 0,
      openSlotMs: OPEN,
    });
    expect(plan.bufferSlots).toEqual([]);
    // Still a hand-over instruction: harmless with no gap to release, and it
    // keeps the write path identical whatever the admin has set.
    expect(plan.releasesParentBufferFrom?.toISOString()).toBe(at(13).toISOString());
  });
});
