"use client";

import {
  Ban,
  CalendarPlus,
  CalendarRange,
  FileText,
  KeyRound,
  LayoutGrid,
  ListChecks,
  ReceiptText,
  Settings,
  UsersRound,
  UtensilsCrossed,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";

type Item = { href: string; label: string; Icon: typeof CalendarPlus; count?: number };

const BOOKING: Item[] = [
  { href: "/rooms", label: "Book a meeting room", Icon: CalendarPlus },
  { href: "/rooms/bookings", label: "My bookings", Icon: ListChecks },
  { href: "/rooms/account", label: "Billing details", Icon: ReceiptText },
];

const ADMIN: Item[] = [
  { href: "/rooms/admin", label: "Bookings", Icon: CalendarRange },
  { href: "/rooms/admin/bookers", label: "Bookers", Icon: UsersRound },
  { href: "/rooms/admin/rooms", label: "Rooms", Icon: LayoutGrid },
  { href: "/rooms/admin/addons", label: "Add-ons", Icon: UtensilsCrossed },
  { href: "/rooms/admin/blocks", label: "Blocked slots", Icon: Ban },
  { href: "/rooms/admin/pages", label: "Pages", Icon: FileText },
  { href: "/rooms/admin/settings", label: "Settings", Icon: Settings },
  { href: "/rooms/admin/access", label: "Access", Icon: KeyRound },
];

/** Which item owns the current path. Detail pages fall under their list. */
function activeHref(pathname: string): string | null {
  if (pathname.startsWith("/rooms/admin")) {
    for (const item of ADMIN) {
      if (item.href !== "/rooms/admin" && pathname.startsWith(item.href)) return item.href;
    }
    return "/rooms/admin";
  }
  if (pathname.startsWith("/rooms/bookings") || pathname.startsWith("/rooms/booked"))
    return "/rooms/bookings";
  if (pathname.startsWith("/rooms/account")) return "/rooms/account";
  // Pages that are neither booking nor account: nothing is highlighted.
  if (pathname.startsWith("/rooms/legal") || pathname.startsWith("/rooms/invoice")) return null;
  // The listing and every room page.
  return pathname === "/rooms" || pathname.startsWith("/rooms/") ? "/rooms" : null;
}

/**
 * One navigation for the whole signed-in site: booking first, for everyone,
 * then the admin for those who have it.
 *
 * It was two: tabs in the header for booking, and a separate rail inside the
 * admin. An admin moved between two unrelated menus, and the header tabs showed
 * on admin pages where they did not belong. A rail on a wide screen, a single
 * scrolling row on a phone.
 */
export default function SiteNav({
  isAdmin,
  attentionCount,
}: {
  isAdmin: boolean;
  attentionCount: number;
}): JSX.Element {
  const pathname = usePathname() ?? "/rooms";
  const active = activeHref(pathname);
  const admin = ADMIN.map((item) =>
    item.href === "/rooms/admin" ? { ...item, count: attentionCount } : item
  );

  const link = (item: Item) => {
    const isActive = item.href === active;
    return (
      <li key={item.href} className="shrink-0">
        <Link
          href={item.href}
          aria-current={isActive ? "page" : undefined}
          className={`flex items-center gap-2.5 whitespace-nowrap rounded-lg px-3 py-2 text-sm transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#000643]/40 ${
            isActive
              ? "bg-[#000643]/[0.07] font-semibold text-[#000643]"
              : "text-gray-600 hover:bg-gray-100 hover:text-[#000643]"
          }`}>
          <item.Icon className="h-4 w-4 shrink-0" aria-hidden />
          {item.label}
          {item.count ? (
            <span
              className="ml-auto rounded-full bg-red-600 px-1.5 font-bold text-[10.5px] text-white tabular-nums leading-[18px]"
              title={`${item.count} ${item.count === 1 ? "item needs" : "items need"} attention`}>
              {item.count}
            </span>
          ) : null}
        </Link>
      </li>
    );
  };

  const heading =
    "mb-1.5 hidden px-3 font-semibold text-[11px] text-gray-400 uppercase tracking-[0.08em] lg:block";

  return (
    <nav aria-label="Site" className="lg:sticky lg:top-6">
      <ul className="-mx-4 flex gap-1 overflow-x-auto border-gray-200 border-b px-4 pb-2 sm:-mx-6 sm:px-6 lg:mx-0 lg:block lg:overflow-visible lg:border-0 lg:px-0 lg:pb-0">
        <li className="contents lg:block">
          <p className={heading}>Booking</p>
          <ul className="contents lg:grid lg:gap-0.5">{BOOKING.map(link)}</ul>
        </li>
        {isAdmin ? (
          <li className="contents lg:mt-5 lg:block">
            {/* On a phone the two groups share one scrolling row; a rule marks the change. */}
            <span className="mx-1 my-2 w-px shrink-0 bg-gray-200 lg:hidden" aria-hidden />
            <p className={heading}>Admin</p>
            <ul className="contents lg:grid lg:gap-0.5">{admin.map(link)}</ul>
          </li>
        ) : null}
      </ul>
    </nav>
  );
}
