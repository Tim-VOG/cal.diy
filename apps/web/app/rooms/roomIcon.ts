import { ROOM_ICON_NAMES, type RoomIconName } from "@calcom/features/ne26-rooms/lib/roomIcons";
import {
  Armchair,
  Briefcase,
  Building,
  Building2,
  Coffee,
  Crown,
  DoorOpen,
  Gem,
  Handshake,
  Lightbulb,
  type LucideIcon,
  MessagesSquare,
  Mic,
  Monitor,
  Presentation,
  Projector,
  ScreenShare,
  Shield,
  Sofa,
  Sparkles,
  Speech,
  Star,
  Tv,
  Users,
} from "lucide-react";

/**
 * The stand-in for a room with no photograph yet.
 *
 * One building glyph for all nine rooms made the listing unreadable while the
 * photos were missing: a Suite and a Small Room looked identical in the place
 * where the buyer is deciding between them.
 *
 * Which glyph is now the admin's decision, not a rule derived from the price
 * band — the person who knows what a room is actually used for is the one
 * selling it. The category default is only what a room starts with.
 */
const BY_NAME: Record<RoomIconName, LucideIcon> = {
  Crown,
  Gem,
  Star,
  Sparkles,
  Presentation,
  Projector,
  Monitor,
  Tv,
  ScreenShare,
  Armchair,
  Sofa,
  Users,
  Handshake,
  MessagesSquare,
  Speech,
  Mic,
  Briefcase,
  DoorOpen,
  Building2,
  Coffee,
  Lightbulb,
  Shield,
};

const BY_CATEGORY: Record<string, LucideIcon> = {
  // A suite: the one with a crown on it, because it is the top of the range.
  PREMIUM: Crown,
  // A large room: a screen on a stand, the thing it is used for.
  INTERMEDIATE: Presentation,
  // A small room: a seat, for a conversation between a few people.
  ENTRY: Armchair,
};

/** Every glyph an admin may pick, in the order the picker shows them. */
export const ROOM_ICON_CHOICES: { name: RoomIconName; Icon: LucideIcon }[] = ROOM_ICON_NAMES.map(
  (name) => ({ name, Icon: BY_NAME[name] })
);

/**
 * The room's own glyph if it has been given one, otherwise its category's.
 *
 * Falls back rather than failing: a name that is no longer in the catalogue —
 * an icon retired after a room was saved with it — must still render something
 * on a public page.
 */
export function roomIconFor(category: string, iconName?: string | null): LucideIcon {
  if (iconName && iconName in BY_NAME) return BY_NAME[iconName as RoomIconName];
  return BY_CATEGORY[category] ?? Building;
}
