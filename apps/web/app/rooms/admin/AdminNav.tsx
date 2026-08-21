"use client";

import { ExternalLink } from "lucide-react";
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
  { href: "/rooms/admin/access", label: "Access" },
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

      {/* The way back out. Without it, leaving the dashboard for the public site
          means editing the URL by hand — which is how the admins were doing it. */}
      <Link
        href="/rooms"
        className="-mb-px ml-auto flex items-center gap-1.5 border-transparent border-b-2 px-4 py-2 font-medium text-gray-500 text-sm transition hover:text-[#000643]">
        <ExternalLink className="h-4 w-4 shrink-0" aria-hidden />
        See platform
      </Link>
    </nav>
  );
}
