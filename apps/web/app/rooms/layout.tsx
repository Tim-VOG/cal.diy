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
          {/* TODO: replace the wordmark with the NE26 logo once provided (/public/ne26-logo.svg). */}
          <Link href="/rooms" className="font-semibold text-lg tracking-tight">
            NATO Edge 26 <span className="font-normal opacity-70">· Rooms</span>
          </Link>
          <span className="text-sm opacity-70">17–19 November 2026</span>
        </div>
      </header>
      <main className="mx-auto max-w-5xl px-6 py-8">{children}</main>
    </div>
  );
}
