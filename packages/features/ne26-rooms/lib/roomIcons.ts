/**
 * NE26: the glyphs an admin may put on a room.
 *
 * A closed list rather than "any Lucide name": the name is written into the
 * database by an admin form and read back by the public pages, so an unknown
 * name would render nothing at all on the page where exhibitors choose. Kept
 * here, outside the web app, so the server can validate a submitted name
 * without importing an icon library.
 */
export const ROOM_ICON_NAMES = [
  "Presentation",
  "Projector",
  "ScreenShare",
  "Monitor",
  "Tv",
  "MonitorPlay",
  "Airplay",
  "Cast",
  "Armchair",
  "Sofa",
  "DoorOpen",
  "DoorClosed",
  "Blinds",
  "LampDesk",
  "LampCeiling",
  "Frame",
  "PanelsTopLeft",
  "Columns3",
  "Rows3",
  "LayoutGrid",
  "Maximize",
  "Users",
  "UsersRound",
  "User",
  "UserRound",
  "Handshake",
  "MessagesSquare",
  "MessageSquare",
  "MessageCircle",
  "Speech",
  "Mic",
  "MicVocal",
  "Podcast",
  "Video",
  "PhoneCall",
  "Contact",
  "IdCard",
  "UserPlus",
  "CircleUserRound",
  "Briefcase",
  "BriefcaseBusiness",
  "Laptop",
  "LaptopMinimal",
  "Notebook",
  "NotebookPen",
  "ClipboardList",
  "FileText",
  "PenTool",
  "Pencil",
  "CalendarClock",
  "Clock",
  "Target",
  "Lightbulb",
  "Rocket",
  "TrendingUp",
  "ChartNoAxesColumn",
  "ChartColumn",
  "Network",
  "Workflow",
  "Coffee",
  "CupSoda",
  "Utensils",
  "UtensilsCrossed",
  "Wine",
  "Cake",
  "Croissant",
  "Sandwich",
  "GlassWater",
  "Martini",
  "Beer",
  "Soup",
  "Crown",
  "Gem",
  "Star",
  "Sparkles",
  "Award",
  "Medal",
  "Trophy",
  "BadgeCheck",
  "Diamond",
  "Flame",
  "Building",
  "Building2",
  "Landmark",
  "Warehouse",
  "Hotel",
  "MapPin",
  "Map",
  "Globe",
  "Flag",
  "TreePalm",
  "Mountain",
  "Wifi",
  "Signal",
  "Speaker",
  "Volume2",
  "Headphones",
  "Radio",
  "Antenna",
  "Plug",
  "Power",
  "Cable",
  "Usb",
  "Bluetooth",
  "Settings",
  "Zap",
  "Shield",
  "ShieldCheck",
  "Lock",
  "KeyRound",
  "Eye",
  "Fingerprint",
  "ScanFace",
] as const;

export type RoomIconName = (typeof ROOM_ICON_NAMES)[number];

/**
 * The same glyphs, in the order and grouping the picker shows them.
 *
 * Everything that actually depicts a meeting room comes first, because that is
 * what nine rooms need. The rest let a room with a character of its own — the
 * one beside the catering, the one with the good screen — say so.
 */
export const ROOM_ICON_GROUPS: { label: string; names: readonly RoomIconName[] }[] = [
  {
    label: "Meeting rooms",
    names: ["Presentation", "Projector", "ScreenShare", "Monitor", "Tv", "MonitorPlay", "Airplay", "Cast", "Armchair", "Sofa", "DoorOpen", "DoorClosed", "Blinds", "LampDesk", "LampCeiling", "Frame", "PanelsTopLeft", "Columns3", "Rows3", "LayoutGrid", "Maximize"],
  },
  {
    label: "People & meetings",
    names: ["Users", "UsersRound", "User", "UserRound", "Handshake", "MessagesSquare", "MessageSquare", "MessageCircle", "Speech", "Mic", "MicVocal", "Podcast", "Video", "PhoneCall", "Contact", "IdCard", "UserPlus", "CircleUserRound"],
  },
  {
    label: "Work",
    names: ["Briefcase", "BriefcaseBusiness", "Laptop", "LaptopMinimal", "Notebook", "NotebookPen", "ClipboardList", "FileText", "PenTool", "Pencil", "CalendarClock", "Clock", "Target", "Lightbulb", "Rocket", "TrendingUp", "ChartNoAxesColumn", "ChartColumn", "Network", "Workflow"],
  },
  {
    label: "Hospitality",
    names: ["Coffee", "CupSoda", "Utensils", "UtensilsCrossed", "Wine", "Cake", "Croissant", "Sandwich", "GlassWater", "Martini", "Beer", "Soup"],
  },
  {
    label: "Prestige",
    names: ["Crown", "Gem", "Star", "Sparkles", "Award", "Medal", "Trophy", "BadgeCheck", "Diamond", "Flame"],
  },
  {
    label: "Building",
    names: ["Building", "Building2", "Landmark", "Warehouse", "Hotel", "MapPin", "Map", "Globe", "Flag", "TreePalm", "Mountain"],
  },
  {
    label: "Technical",
    names: ["Wifi", "Signal", "Speaker", "Volume2", "Headphones", "Radio", "Antenna", "Plug", "Power", "Cable", "Usb", "Bluetooth", "Settings", "Zap"],
  },
  {
    label: "Security",
    names: ["Shield", "ShieldCheck", "Lock", "KeyRound", "Eye", "Fingerprint", "ScanFace"],
  },
];

export function isRoomIconName(value: unknown): value is RoomIconName {
  return typeof value === "string" && (ROOM_ICON_NAMES as readonly string[]).includes(value);
}
