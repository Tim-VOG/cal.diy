"use client";

import { CalendarDays, PlusCircle, Search } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS = [
  { href: "/rooms/desk", label: "Today", icon: CalendarDays },
  { href: "/rooms/desk/search", label: "Find a booking", icon: Search },
  { href: "/rooms/desk/new", label: "New booking", icon: PlusCircle },
];

/**
 * Deliberately large touch targets: this runs on a tablet, standing up, often
 * one-handed while talking to someone.
 */
export default function DeskNav({ isAdmin }: { isAdmin: boolean }): JSX.Element {
  const pathname = usePathname() ?? "/rooms/desk";

  return (
    <header className="bg-[#000643] text-white">
      <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-6">
        <span className="font-semibold text-lg">Welcome desk</span>
        {isAdmin ? (
          <Link
            href="/rooms/admin"
            className="rounded-md border border-white/40 px-2.5 py-1 font-medium text-sm transition hover:bg-white/10">
            Admin
          </Link>
        ) : null}
      </div>
      <nav className="mx-auto flex max-w-5xl gap-1 px-2 sm:px-4">
        {TABS.map((tab) => {
          const active = tab.href === "/rooms/desk" ? pathname === tab.href : pathname.startsWith(tab.href);
          const Icon = tab.icon;
          return (
            <Link
              key={tab.href}
              href={tab.href}
              className={`-mb-px flex items-center gap-2 border-b-2 px-4 py-3 font-medium text-sm transition ${
                active ? "border-white text-white" : "border-transparent text-white/70 hover:text-white"
              }`}>
              <Icon className="h-4 w-4 shrink-0" aria-hidden />
              {tab.label}
            </Link>
          );
        })}
      </nav>
    </header>
  );
}
