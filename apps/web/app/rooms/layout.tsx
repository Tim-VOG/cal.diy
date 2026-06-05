import { getServerSession } from "@calcom/features/auth/lib/getServerSession";
import { buildLegacyRequest } from "@lib/buildLegacyCtx";
import { cookies, headers } from "next/headers";
import Link from "next/link";
import type { ReactNode } from "react";
import Footer from "./Footer";
import LogoutButton from "./LogoutButton";

// Standalone public layout: it deliberately skips Cal's logged-in shell and the
// booking PageWrapper — these pages are public and brand-themed (NATO Edge 26).
// The root app/layout.tsx still provides <html>/<body>, global CSS and providers.
//
// The session is read here only to show the right login/logout control — page
// authorization stays in each page.tsx, never in this layout.
export default async function RoomsLayout({ children }: { children: ReactNode }) {
  const session = await getServerSession({ req: buildLegacyRequest(await headers(), await cookies()) });
  const isLoggedIn = Boolean(session?.user?.id);

  return (
    <div className="flex min-h-screen flex-col bg-gray-50 text-black">
      <header className="bg-[#000643] text-white">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-4">
          <Link
            href="/rooms"
            className="flex items-center gap-4"
            aria-label="VO Europe — NATO Edge 26 Rooms — home">
            {/* Both logos are white-on-transparent, so they sit on the navy bar. */}
            {/* biome-ignore lint/performance/noImgElement: static brand asset, next/image adds no value here */}
            <img src="/VOEU.png" alt="VO Europe" className="h-7 w-auto" />
            <span className="h-7 w-px bg-white/25" aria-hidden />
            {/* biome-ignore lint/performance/noImgElement: static brand asset, next/image adds no value here */}
            <img src="/NE26.png" alt="NATO Edge 26" className="h-8 w-auto" />
          </Link>
          <div className="flex items-center gap-5">
            <span className="hidden text-sm opacity-70 sm:inline">17–19 November 2026</span>
            {isLoggedIn ? (
              <>
                <Link href="/rooms/account" className="text-sm opacity-80 transition hover:opacity-100">
                  Billing details
                </Link>
                <LogoutButton />
              </>
            ) : (
              <Link
                href="/rooms/login"
                className="rounded-md border border-white/30 px-3 py-1 text-sm transition hover:bg-white/10">
                Log in
              </Link>
            )}
          </div>
        </div>
      </header>
      <main className="mx-auto w-full max-w-5xl flex-1 px-6 py-8">{children}</main>
      <Footer />
    </div>
  );
}
