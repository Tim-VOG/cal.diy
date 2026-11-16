import { prisma } from "@calcom/prisma";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Ne26RoomSettingsRepository } from "./Ne26RoomSettingsRepository";

/**
 * The settings row is the admin's one lever on the booking rules, and it is a
 * singleton: a field that reads back but never writes, or writes but never
 * reads, breaks silently and only shows up as an admin changing something that
 * then does nothing.
 *
 * This covers the round trip for `maxRoomsPerDayPerExhibitor` specifically,
 * because it is the first setting that governs how much can be SOLD rather than
 * how a page looks.
 */
describe("Ne26RoomSettingsRepository", () => {
  const repo = new Ne26RoomSettingsRepository(prisma);
  let restore = 1;

  beforeAll(async () => {
    const before = await repo.get();
    restore = before.maxRoomsPerDayPerExhibitor;
  });

  afterAll(async () => {
    // One shared row: leaving it raised would quietly change the rule for every
    // suite that runs after this one.
    await repo.update({ maxRoomsPerDayPerExhibitor: restore });
  });

  it("reads the rooms-per-day cap", async () => {
    const settings = await repo.get();
    expect(typeof settings.maxRoomsPerDayPerExhibitor).toBe("number");
    expect(settings.maxRoomsPerDayPerExhibitor).toBeGreaterThanOrEqual(1);
  });

  it("writes the cap and reads back what it wrote", async () => {
    const written = await repo.update({ maxRoomsPerDayPerExhibitor: 3 });
    expect(written.maxRoomsPerDayPerExhibitor).toBe(3);

    // Through a second read, not the update's own return value: the update
    // selects its own result, so only a fresh read proves it reached the row.
    const read = await repo.get();
    expect(read.maxRoomsPerDayPerExhibitor).toBe(3);
  });

  it("leaves the cap alone when an unrelated setting is saved", async () => {
    await repo.update({ maxRoomsPerDayPerExhibitor: 2 });
    // The admin form posts whichever fields it owns; a partial patch must not
    // reset the others to their defaults.
    const after = await repo.update({ landingTitle: `cap-test-${Date.now()}` });
    expect(after.maxRoomsPerDayPerExhibitor).toBe(2);
  });
});
