import { describe, expect, it } from "vitest";
import { byDoorName, roomDoorName, roomFullLabel, roomSoldName } from "./roomNames";

const large1 = { name: "Large Room 1", venueName: "Meeting 3" };
const suite1 = { name: "Suite 1", venueName: null };

describe("naming a room at the venue", () => {
  it("leads with the door name", () => {
    expect(roomDoorName(large1)).toBe("Meeting 3");
    expect(roomSoldName(large1)).toBe("Large Room 1");
  });

  it("says a room with no door name once, not twice", () => {
    // The suites are called the same thing on both sides; repeating it would
    // read as a mistake.
    expect(roomDoorName(suite1)).toBe("Suite 1");
    expect(roomSoldName(suite1)).toBeNull();
    expect(roomFullLabel(suite1)).toBe("Suite 1");
  });

  it("treats a door name equal to the sold name as no door name", () => {
    const same = { name: "Suite 2", venueName: "Suite 2" };
    expect(roomSoldName(same)).toBeNull();
    expect(roomFullLabel(same)).toBe("Suite 2");
  });

  it("ignores a blank or missing door name", () => {
    expect(roomDoorName({ name: "Suite 1", venueName: "   " })).toBe("Suite 1");
    expect(roomDoorName({ name: "Suite 1" })).toBe("Suite 1");
    expect(roomSoldName({ name: "Suite 1", venueName: "" })).toBeNull();
  });

  it("puts both names in one cell for a spreadsheet", () => {
    // The caterer and the floor staff read the door; whoever reconciles it
    // against an invoice reads the name it was sold under.
    expect(roomFullLabel(large1)).toBe("Meeting 3 (Large Room 1)");
  });
});

describe("ordering rooms for the desk", () => {
  it("lists them by door number, not by the order they were created in", () => {
    // Stored order is grouped by size; the doors are not numbered that way.
    const stored = [
      { name: "Suite 1", venueName: null },
      { name: "Suite 2", venueName: null },
      { name: "Large Room 1", venueName: "Meeting 3" },
      { name: "Large Room 2", venueName: "Meeting 4" },
      { name: "Small Room 1", venueName: "Meeting 1" },
      { name: "Small Room 2", venueName: "Meeting 2" },
      { name: "Small Room 3", venueName: "Meeting 5" },
    ];
    expect([...stored].sort(byDoorName).map(roomDoorName)).toEqual([
      "Meeting 1",
      "Meeting 2",
      "Meeting 3",
      "Meeting 4",
      "Meeting 5",
      "Suite 1",
      "Suite 2",
    ]);
  });

  it("counts numerically, so a tenth door does not sort next to the first", () => {
    const rooms = [
      { name: "a", venueName: "Meeting 10" },
      { name: "b", venueName: "Meeting 2" },
    ];
    expect([...rooms].sort(byDoorName).map(roomDoorName)).toEqual(["Meeting 2", "Meeting 10"]);
  });
});
