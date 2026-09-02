import { Cable, Coffee, GlassWater, type LucideIcon, Monitor } from "lucide-react";

/**
 * What each category includes in its price, per VO's offer.
 *
 * Suites carry the extra that justifies their premium over a same-capacity
 * meeting room, so the difference has to be visible on the page — a buyer
 * choosing between a 12-person Suite and a 12-person Meeting Room is looking at
 * a ~300 EUR gap and needs to see what it buys.
 *
 * Kept in code for now: the content is fixed for the event. Making it
 * admin-editable belongs with the rooms-admin rework.
 */
export interface RoomService {
  icon: LucideIcon;
  label: string;
  /** Longer text shown on the room page, where there is room for it. */
  detail?: string;
}

const BASE_SERVICES: RoomService[] = [
  {
    icon: Monitor,
    label: "Large screen",
    // Wim's wording. The ports matter: an exhibitor arriving with a laptop that
    // has neither wants to know before the meeting, not during it.
    detail: "A large screen with USB A and HDMI ports",
  },
  { icon: Cable, label: "HDMI cable", detail: "A 3-metre HDMI cable is provided" },
  { icon: GlassWater, label: "Water", detail: "Still water provided in the room" },
];

const SUITE_EXTRAS: RoomService[] = [
  {
    icon: Coffee,
    label: "Permanent coffee break",
    // The caterer's own list for the suites: a complimentary beverage set-up
    // available on arrival and throughout the booking.
    detail:
      "Coffee machine (espresso, Americano, coffee with milk), a variety of teas, bottled water and soft drinks — available throughout your booking",
  },
];

/** Services included for a room, by category. */
export function servicesFor(category: string): RoomService[] {
  return category === "PREMIUM" ? [...BASE_SERVICES, ...SUITE_EXTRAS] : BASE_SERVICES;
}

/** Back-compat for callers that only need the common set. */
export const AMENITIES = BASE_SERVICES;
