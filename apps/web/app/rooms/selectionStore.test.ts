import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearAllSelections,
  clearSelection,
  getSelection,
  listSelections,
  saveSelection,
} from "./selectionStore";

const NOW = new Date("2026-11-01T10:00:00.000Z").getTime();

function selection(slug: string, over: Partial<Parameters<typeof saveSelection>[0]> = {}) {
  return {
    slug,
    roomName: `Room ${slug}`,
    date: "2026-11-17",
    startUtc: "2026-11-17T13:00:00.000Z",
    durationHours: 2,
    addOns: { catering: 4 },
    total: 129600,
    currency: "EUR",
    ...over,
  };
}

describe("selectionStore", () => {
  beforeEach(() => {
    clearAllSelections();
  });

  it("gives back what was saved", () => {
    saveSelection(selection("suite-1"), NOW);
    expect(getSelection("suite-1", NOW)).toMatchObject({
      roomName: "Room suite-1",
      startUtc: "2026-11-17T13:00:00.000Z",
      durationHours: 2,
      addOns: { catering: 4 },
    });
  });

  it("keeps one selection per room and lists the newest first", () => {
    saveSelection(selection("suite-1"), NOW);
    saveSelection(selection("small-3"), NOW + 1000);

    const all = listSelections(NOW + 2000);
    expect(all.map((s) => s.slug)).toEqual(["small-3", "suite-1"]);
  });

  it("replaces a room's selection rather than piling them up", () => {
    saveSelection(selection("suite-1", { durationHours: 1 }), NOW);
    saveSelection(selection("suite-1", { durationHours: 3 }), NOW + 1000);

    const all = listSelections(NOW + 2000);
    expect(all).toHaveLength(1);
    expect(all[0].durationHours).toBe(3);
  });

  it("does not remember an untouched page", () => {
    // No slot and no add-ons is the default state, not a decision worth storing.
    saveSelection(selection("suite-1", { startUtc: null, addOns: {} }), NOW);
    expect(getSelection("suite-1", NOW)).toBeNull();
  });

  it("clears a room once it no longer has a selection", () => {
    saveSelection(selection("suite-1"), NOW);
    saveSelection(selection("suite-1", { startUtc: null, addOns: {} }), NOW + 1000);
    expect(getSelection("suite-1", NOW + 2000)).toBeNull();
  });

  it("forgets a selection once it goes stale", () => {
    // A stored price and slot both age; a seven-hour-old one must not come back
    // next to a room that has since been sold or repriced.
    saveSelection(selection("suite-1"), NOW);
    expect(getSelection("suite-1", NOW + 7 * 60 * 60 * 1000)).toBeNull();
    expect(listSelections(NOW + 7 * 60 * 60 * 1000)).toEqual([]);
  });

  it("removes one room without touching the others", () => {
    saveSelection(selection("suite-1"), NOW);
    saveSelection(selection("small-3"), NOW);
    clearSelection("suite-1", NOW);
    expect(listSelections(NOW).map((s) => s.slug)).toEqual(["small-3"]);
  });

  it("survives corrupt storage rather than breaking the page", () => {
    globalThis.sessionStorage.setItem("ne26-rooms.selections.v1", "{not json");
    expect(listSelections(NOW)).toEqual([]);
    expect(getSelection("suite-1", NOW)).toBeNull();
  });

  it("drops entries that are not selections", () => {
    globalThis.sessionStorage.setItem(
      "ne26-rooms.selections.v1",
      JSON.stringify({
        "suite-1": { slug: "suite-1" },
        "small-3": { ...selection("small-3"), savedAt: NOW },
      })
    );
    // The well-formed one survives; the truncated one is ignored.
    expect(listSelections(NOW).map((s) => s.slug)).toEqual(["small-3"]);
  });

  it("still lets the page work when storage throws", () => {
    // Private browsing and storage-blocking extensions throw on access.
    const spy = vi.spyOn(globalThis.Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("SecurityError");
    });
    expect(() => listSelections(NOW)).not.toThrow();
    expect(listSelections(NOW)).toEqual([]);
    spy.mockRestore();
  });
});
