import { Armchair, Building, Crown, type LucideIcon, Presentation } from "lucide-react";

/**
 * The stand-in for a room with no photograph yet.
 *
 * One building glyph for all nine rooms made the listing unreadable while the
 * photos were missing: a Suite and a Small Room looked identical in the place
 * where the buyer is deciding between them. Three glyphs, one per category,
 * carrying the same order the prices do.
 *
 * Deliberately plain shapes rather than decorative ones — they sit at 40px in a
 * grey placeholder and have to read at a glance, not be admired.
 */
const BY_CATEGORY: Record<string, LucideIcon> = {
  // A suite: the one with a crown on it, because it is the top of the range.
  PREMIUM: Crown,
  // A large room: a screen on a stand, the thing it is used for.
  INTERMEDIATE: Presentation,
  // A small room: a seat, for a conversation between a few people.
  ENTRY: Armchair,
};

export function roomIconFor(category: string): LucideIcon {
  return BY_CATEGORY[category] ?? Building;
}
