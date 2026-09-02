import { getServerSession } from "@calcom/features/auth/lib/getServerSession";
import { buildLegacyRequest } from "@lib/buildLegacyCtx";
import { cookies, headers } from "next/headers";
import Link from "next/link";
import type { ReactNode } from "react";
import { getNe26RoomSettingsRepository } from "@calcom/features/ne26-rooms/di/Ne26RoomSettingsRepository.container";
import Footer from "./Footer";
import LogoutButton from "./LogoutButton";
import MainArea from "./MainArea";
import ShortlistPanel from "./ShortlistPanel";

// Standalone public layout: it deliberately skips Cal's logged-in shell and the
// booking PageWrapper — these pages are public and brand-themed (NATO Edge 26).
// The root app/layout.tsx still provides <html>/<body>, global CSS and providers.
//
// The session is read here only to show the right login/logout control — page
// authorization stays in each page.tsx, never in this layout.
export default async function RoomsLayout({ children }: { children: ReactNode }) {
  const session = await getServerSession({ req: buildLegacyRequest(await headers(), await cookies()) });
  const isLoggedIn = Boolean(session?.user?.id);
  // Admins had no way in from the site — you had to type /rooms/admin by hand.
  // The link only renders for them; the admin pages keep their own authorization.
  const isAdmin = session?.user?.role === "ADMIN";
  // The event's days, so the shortlist can say which are still open. Only
  // needed for someone who can actually book.
  const eventDays = isLoggedIn
    ? (await getNe26RoomSettingsRepository().get()).eventDays.map((d) => d.date)
    : [];

  return (
    <div className="flex min-h-screen flex-col bg-gray-50 text-black">
      {/* Two rows rather than one. Seven controls crammed onto a single line
          left the links touching each other, and the event dates competing with
          navigation for the same space. Identity and context on top, the things
          you click underneath. */}
      <header className="bg-[#000643] text-white">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-x-6 gap-y-3 px-4 py-4 sm:px-6">
          <Link
            href="/rooms"
            className="flex items-center gap-3 sm:gap-4"
            aria-label="VO Europe — NATO Edge 26 Rooms — home">
            {/* Both logos are white-on-transparent, so they sit on the navy bar.
                Slightly smaller on mobile so both fit beside the controls. */}
            {/* biome-ignore lint/performance/noImgElement: static brand asset, next/image adds no value here */}
            <img src="/VOEU.png" alt="VO Europe" className="h-5 w-auto sm:h-7" />
            <span className="h-5 w-px bg-white/25 sm:h-7" aria-hidden />
            {/* biome-ignore lint/performance/noImgElement: static brand asset, next/image adds no value here */}
            <img src="/NE26.png" alt="NATO Edge 26" className="h-7 w-auto sm:h-8" />
          </Link>

          <div className="flex items-center gap-4 sm:gap-6">
            <span className="hidden text-right text-sm leading-tight opacity-70 lg:block">
              17–19 November 2026
              <span className="block text-xs">Fuar İzmir, Türkiye</span>
            </span>
            {isLoggedIn ? (
              <>
                {isAdmin ? (
                  <Link
                    href="/rooms/admin"
                    className="shrink-0 rounded-md border border-white/40 px-3 py-1.5 font-medium text-sm transition hover:bg-white/10">
                    Admin
                  </Link>
                ) : null}
                <LogoutButton />
              </>
            ) : (
              <Link
                href="/rooms/login"
                className="shrink-0 rounded-md border border-white/30 px-3 py-1.5 text-sm transition hover:bg-white/10">
                Log in
              </Link>
            )}
          </div>
        </div>

        {isLoggedIn ? (
          <nav className="border-white/10 border-t">
            <div className="mx-auto flex max-w-6xl gap-1 px-2 sm:px-4">
              {[
                { href: "/rooms", label: "Book a meeting room" },
                { href: "/rooms/bookings", label: "My bookings" },
                { href: "/rooms/account", label: "Billing details" },
              ].map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  className="whitespace-nowrap px-4 py-3 font-medium text-sm text-white/75 transition hover:text-white">
                  {item.label}
                </Link>
              ))}
            </div>
          </nav>
        ) : null}
      </header>
      <MainArea>{children}</MainArea>
      {/* Rendered here so it follows the exhibitor from the listing into a
          room and back. On a wide screen it parks to the right of the content;
          below that it pins to the bottom. Nothing at all when there is
          neither a shortlist nor an unpaid hold. */}
      {isLoggedIn ? <ShortlistPanel eventDays={eventDays} /> : null}
      <Footer />
    </div>
  );
}
