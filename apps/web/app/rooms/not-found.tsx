import { ArrowLeft, SearchX } from "lucide-react";
import Link from "next/link";

/**
 * Anything under /rooms that does not resolve lands here.
 *
 * A mistyped room slug matches the [slug] route, finds no room and calls
 * notFound() — which without this file served Cal's generic 404: no NE26
 * branding, no header, and no way back into the app short of editing the URL.
 */
export default function RoomsNotFound(): JSX.Element {
  return (
    <div className="mx-auto max-w-md py-12 text-center">
      <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-[#000643]/5 text-[#000643]">
        <SearchX className="h-7 w-7" aria-hidden />
      </div>
      <h1 className="mt-5 font-bold text-2xl text-[#000643]">This page doesn&apos;t exist</h1>
      <p className="mt-2 text-gray-600 text-sm">
        The room may have been renamed or is no longer available. Everything on offer is on the listing.
      </p>
      <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
        <Link
          href="/rooms"
          className="inline-flex items-center gap-2 rounded-lg bg-[#000643] px-4 py-2 font-medium text-sm text-white transition hover:bg-[#000643]/90">
          <ArrowLeft className="h-4 w-4" aria-hidden />
          Back to the rooms
        </Link>
        <Link
          href="/rooms/bookings"
          className="inline-flex items-center gap-2 rounded-lg border border-gray-200 px-4 py-2 font-medium text-[#000643] text-sm transition hover:border-[#000643]">
          My bookings
        </Link>
      </div>
    </div>
  );
}
