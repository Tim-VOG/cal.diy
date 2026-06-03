import { Cable, GlassWater, type LucideIcon, Monitor } from "lucide-react";

// Amenities common to every room for the event (static for now). Shared by the
// listing cards and the room detail page.
export const AMENITIES: { icon: LucideIcon; label: string }[] = [
  { icon: Monitor, label: "Screen" },
  { icon: Cable, label: "Wired cable for screen sharing" },
  { icon: GlassWater, label: "Water fountain" },
];
