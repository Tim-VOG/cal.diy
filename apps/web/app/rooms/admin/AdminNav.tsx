"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS = [
  { href: "/rooms/admin", label: "Bookings" },
  { href: "/rooms/admin/bookers", label: "Bookers" },
  { href: "/rooms/admin/rooms", label: "Rooms" },
  { href: "/rooms/admin/addons", label: "Add-ons" },
  { href: "/rooms/admin/blocks", label: "Blocked slots" },
  { href: "/rooms/admin/pages", label: "Pages" },
  { href: "/rooms/admin/settings", label: "Settings" },
];

// Which tab owns the current path (booking detail pages fall under Bookings).
function activeHref(pathname: string): string {
  for (const tab of TABS) {
    if (tab.href !== "/rooms/admin" && pathname.startsWith(tab.href)) return tab.href;
  }
  return "/rooms/admin";
}

export default function AdminNav(): JSX.Element {
  const pathname = usePathname() ?? "/rooms/admin";
  const active = activeHref(pathname);
  return (
    <nav className="mb-6 flex flex-wrap gap-1 border-gray-200 border-b">
      {TABS.map((tab) => (
        <Link
          key={tab.href}
          href={tab.href}
          className={`-mb-px border-b-2 px-4 py-2 font-medium text-sm transition ${
            tab.href === active
              ? "border-[#000643] text-[#000643]"
              : "border-transparent text-gray-500 hover:text-[#000643]"
          }`}>
          {tab.label}
        </Link>
      ))}
    </nav>
  );
}
