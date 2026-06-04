import { ErrorCode } from "@calcom/lib/errorCodes";
import { ErrorWithCode } from "@calcom/lib/errors";
import { describe, expect, it } from "vitest";
import { getAtomicSlotStarts, getBufferSlotStarts } from "./atomicSlots";

describe("getAtomicSlotStarts", () => {
  it("splits a 1h booking into four 15-minute slots", () => {
    const start = new Date("2026-11-17T09:00:00.000Z");
    expect(getAtomicSlotStarts(start, 60).map((d) => d.toISOString())).toEqual([
      "2026-11-17T09:00:00.000Z",
      "2026-11-17T09:15:00.000Z",
      "2026-11-17T09:30:00.000Z",
      "2026-11-17T09:45:00.000Z",
    ]);
  });

  it("splits a 2h booking into eight slots", () => {
    const start = new Date("2026-11-18T15:00:00.000Z");
    const slots = getAtomicSlotStarts(start, 120);
    expect(slots).toHaveLength(8);
    expect(slots[0].toISOString()).toBe("2026-11-18T15:00:00.000Z");
    expect(slots[7].toISOString()).toBe("2026-11-18T16:45:00.000Z");
  });

  it("accepts a start on a 15-minute boundary", () => {
    const start = new Date("2026-11-17T09:30:00.000Z");
    expect(getAtomicSlotStarts(start, 60).map((d) => d.toISOString())).toEqual([
      "2026-11-17T09:30:00.000Z",
      "2026-11-17T09:45:00.000Z",
      "2026-11-17T10:00:00.000Z",
      "2026-11-17T10:15:00.000Z",
    ]);
  });

  it("rejects an unsupported duration", () => {
    const start = new Date("2026-11-17T09:00:00.000Z");
    expect(() => getAtomicSlotStarts(start, 90)).toThrowError(ErrorWithCode);
    try {
      getAtomicSlotStarts(start, 90);
    } catch (e) {
      expect((e as ErrorWithCode).code).toBe(ErrorCode.BadRequest);
    }
  });

  it("rejects a start not on a 15-minute boundary", () => {
    const start = new Date("2026-11-17T09:07:00.000Z");
    expect(() => getAtomicSlotStarts(start, 60)).toThrowError(ErrorWithCode);
  });
});

describe("getBufferSlotStarts", () => {
  it("reserves one slot for a 15-minute buffer after the booking ends", () => {
    const start = new Date("2026-11-17T09:00:00.000Z"); // 1h -> ends 10:00
    expect(getBufferSlotStarts(start, 60, 15).map((d) => d.toISOString())).toEqual([
      "2026-11-17T10:00:00.000Z",
    ]);
  });

  it("reserves two slots for a 30-minute buffer", () => {
    const start = new Date("2026-11-17T09:00:00.000Z");
    expect(getBufferSlotStarts(start, 60, 30).map((d) => d.toISOString())).toEqual([
      "2026-11-17T10:00:00.000Z",
      "2026-11-17T10:15:00.000Z",
    ]);
  });

  it("reserves nothing when the buffer is zero", () => {
    const start = new Date("2026-11-17T09:00:00.000Z");
    expect(getBufferSlotStarts(start, 60, 0)).toEqual([]);
  });
});
