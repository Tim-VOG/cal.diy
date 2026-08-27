import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { EVENT_TIME_ZONE } from "./eventSchedule";

/**
 * CLAUDE.md rule 6: the event's timezone is declared once, in EVENT_TIME_ZONE,
 * and never written out again anywhere else.
 *
 * This is not pedantry. The event moved from Brussels to Izmir once already,
 * and the sites that were missed were exactly these scattered literals — the
 * admin table went on formatting Istanbul times under a column headed
 * "Brussels" for weeks. A rule nobody can check is a rule that decays, so this
 * checks it.
 */
const ROOTS = [
  resolve(__dirname, ".."), // packages/features/ne26-rooms
  resolve(__dirname, "../../../../apps/web/app/rooms"),
];

/** Where the zone is allowed to appear as a literal. */
const DECLARATION = "packages/features/ne26-rooms/lib/eventSchedule.ts";

/** Any IANA zone name, so a stray "Europe/Brussels" is caught too. */
const ZONE = /["'](?:Africa|America|Antarctica|Asia|Atlantic|Australia|Europe|Indian|Pacific)\/[A-Za-z_]+["']/;

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === ".next") continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(...sourceFiles(full));
    } else if (/\.tsx?$/.test(entry) && !/\.(test|integration-test)\.tsx?$/.test(entry)) {
      out.push(full);
    }
  }
  return out;
}

describe("the event timezone is declared exactly once", () => {
  it("is Europe/Istanbul", () => {
    // Izmir keeps Istanbul time: UTC+3 all year, no DST since 2016.
    expect(EVENT_TIME_ZONE).toBe("Europe/Istanbul");
  });

  it("appears as a literal nowhere but its declaration", () => {
    const repoRoot = resolve(__dirname, "../../../..");
    const offenders: string[] = [];

    for (const root of ROOTS) {
      for (const file of sourceFiles(root)) {
        const rel = relative(repoRoot, file);
        if (rel === DECLARATION) continue;
        const source = readFileSync(file, "utf8");
        source.split("\n").forEach((line, i) => {
          // A comment may name a zone while explaining why; only code counts.
          const code = line.replace(/\/\/.*$/, "").replace(/\/\*.*?\*\//g, "");
          if (ZONE.test(code)) offenders.push(`${rel}:${i + 1} — ${line.trim()}`);
        });
      }
    }

    // Named in the failure so the fix is obvious: import EVENT_TIME_ZONE.
    expect(offenders).toEqual([]);
  });
});
