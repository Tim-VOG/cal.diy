"use client";

import {
  Ban,
  CalendarRange,
  ExternalLink,
  FileText,
  KeyRound,
  LayoutGrid,
  Settings,
  UsersRound,
  UtensilsCrossed,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS = [
  { href: "/rooms/admin", label: "Bookings", Icon: CalendarRange },
  { href: "/rooms/admin/bookers", label: "Bookers", Icon: UsersRound },
  { href: "/rooms/admin/rooms", label: "Rooms", Icon: LayoutGrid },
  { href: "/rooms/admin/addons", label: "Add-ons", Icon: UtensilsCrossed },
  { href: "/rooms/admin/blocks", label: "Blocked slots", Icon: Ban },
  { href: "/rooms/admin/pages", label: "Pages", Icon: FileText },
  { href: "/rooms/admin/settings", label: "Settings", Icon: Settings },
  { href: "/rooms/admin/access", label: "Access", Icon: KeyRound },
];

// Which tab owns the current path (booking and order detail pages fall under Bookings).
function activeHref(pathname: string): string {
  for (const tab of TABS) {
    if (tab.href !== "/rooms/admin" && pathname.startsWith(tab.href)) return tab.href;
  }
  return "/rooms/admin";
}

/**
 * The admin's navigation: a rail on a wide screen, a scrolling row on a narrow one.
 *
 * The rail carries a count on Bookings — the things on that page that cost money
 * if left — so the number is visible from every other tab, which is where
 * someone is when a paid order loses its room.
 */
export default function AdminNav({ attentionCount }: { attentionCount: number }): JSX.Element {
  const pathname = usePathname() ?? "/rooms/admin";
  const active = activeHref(pathname);

  return (
    <nav aria-label="Admin" className="lg:sticky lg:top-6">
      <p className="mb-2 hidden px-3 font-semibold text-[11px] text-gray-400 uppercase tracking-[0.08em] lg:block">
        Admin
      </p>
      <ul className="-mx-4 flex gap-1 overflow-x-auto border-gray-200 border-b px-4 pb-2 sm:-mx-6 sm:px-6 lg:mx-0 lg:flex-col lg:overflow-visible lg:border-0 lg:px-0 lg:pb-0">
        {TABS.map(({ href, label, Icon }) => {
          const isActive = href === active;
          const showCount = href === "/rooms/admin" && attentionCount > 0;
          return (
            <li key={href} className="shrink-0">
              <Link
                href={href}
                aria-current={isActive ? "page" : undefined}
                className={`flex items-center gap-2.5 whitespace-nowrap rounded-lg px-3 py-2 text-sm transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#000643]/40 ${
                  isActive
                    ? "bg-[#000643]/[0.07] font-semibold text-[#000643]"
                    : "text-gray-600 hover:bg-gray-100 hover:text-[#000643]"
                }`}>
                <Icon className="h-4 w-4 shrink-0" aria-hidden />
                {label}
                {showCount ? (
                  <span
                    className="ml-auto rounded-full bg-red-600 px-1.5 font-bold text-[10.5px] text-white tabular-nums leading-[18px]"
                    title={`${attentionCount} ${attentionCount === 1 ? "item needs" : "items need"} attention`}>
                    {attentionCount}
                  </span>
                ) : null}
              </Link>
            </li>
          );
        })}
      </ul>
      {/* The way back out. Without it, leaving the dashboard for the public site
          means editing the URL by hand — which is how the admins were doing it. */}
      <Link
        href="/rooms"
        className="mt-4 hidden items-center gap-2.5 border-gray-200 border-t px-3 pt-4 text-gray-500 text-sm transition hover:text-[#000643] lg:flex">
        <ExternalLink className="h-4 w-4 shrink-0" aria-hidden />
        See platform
      </Link>
    </nav>
  );
}
