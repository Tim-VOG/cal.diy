import Link from "next/link";
import type { ReactNode } from "react";

// Standalone public layout: it deliberately skips Cal's logged-in shell and the
// booking PageWrapper — these pages are public and brand-themed (NATO Edge 26).
// The root app/layout.tsx still provides <html>/<body>, global CSS and providers.
export default function RoomsLayout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen bg-gray-50 text-black">
      <header className="bg-[#000643] text-white">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-4">
          <Link href="/rooms" className="flex items-center" aria-label="NATO Edge 26 Rooms — home">
            {/* White logo: it sits on the navy (#000643) header bar. */}
            {/* biome-ignore lint/performance/noImgElement: static brand SVG, next/image adds no value here */}
            <img src="/NE26-WHITE.svg" alt="NATO Edge 26" className="h-9 w-auto" />
          </Link>
          <div className="flex items-center gap-5">
            <Link href="/rooms/account" className="text-sm opacity-80 transition hover:opacity-100">
              Billing details
            </Link>
            <span className="text-sm opacity-70">17–19 November 2026</span>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-5xl px-6 py-8">{children}</main>
    </div>
  );
}
