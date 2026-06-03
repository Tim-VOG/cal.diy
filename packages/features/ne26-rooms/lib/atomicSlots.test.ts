import { ErrorCode } from "@calcom/lib/errorCodes";
import { ErrorWithCode } from "@calcom/lib/errors";
import { describe, expect, it } from "vitest";
import { getAtomicSlotStarts } from "./atomicSlots";

describe("getAtomicSlotStarts", () => {
  it("returns one slot for a 1h booking", () => {
    const start = new Date("2026-11-17T09:00:00.000Z");
    expect(getAtomicSlotStarts(start, 60).map((d) => d.toISOString())).toEqual(["2026-11-17T09:00:00.000Z"]);
  });

  it("returns two consecutive slots for a 2h booking", () => {
    const start = new Date("2026-11-18T15:00:00.000Z");
    expect(getAtomicSlotStarts(start, 120).map((d) => d.toISOString())).toEqual([
      "2026-11-18T15:00:00.000Z",
      "2026-11-18T16:00:00.000Z",
    ]);
  });

  it("returns three consecutive slots for a 3h booking", () => {
    const start = new Date("2026-11-19T09:00:00.000Z");
    expect(getAtomicSlotStarts(start, 180).map((d) => d.toISOString())).toEqual([
      "2026-11-19T09:00:00.000Z",
      "2026-11-19T10:00:00.000Z",
      "2026-11-19T11:00:00.000Z",
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

  it("rejects a start time that is not on the hour", () => {
    const start = new Date("2026-11-17T09:30:00.000Z");
    expect(() => getAtomicSlotStarts(start, 60)).toThrowError(ErrorWithCode);
  });
});
