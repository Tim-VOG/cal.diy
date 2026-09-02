/**
 * NE26: the glyphs an admin may put on a room.
 *
 * A closed list rather than "any Lucide name": the name is written into the
 * database by an admin form and read back by the public pages, so an unknown
 * name would render nothing at all on the page where exhibitors choose. Kept
 * here, outside the web app, so the server can validate a submitted name
 * without importing an icon library.
 *
 * Chosen for a room listing, not for decoration — prestige, screen, and the
 * kind of meeting the room is for.
 */
export const ROOM_ICON_NAMES = [
  "Crown",
  "Gem",
  "Star",
  "Sparkles",
  "Presentation",
  "Projector",
  "Monitor",
  "Tv",
  "ScreenShare",
  "Armchair",
  "Sofa",
  "Users",
  "Handshake",
  "MessagesSquare",
  "Speech",
  "Mic",
  "Briefcase",
  "DoorOpen",
  "Building2",
  "Coffee",
  "Lightbulb",
  "Shield",
] as const;

export type RoomIconName = (typeof ROOM_ICON_NAMES)[number];

export function isRoomIconName(value: unknown): value is RoomIconName {
  return typeof value === "string" && (ROOM_ICON_NAMES as readonly string[]).includes(value);
}
