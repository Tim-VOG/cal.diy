import { ArrowLeft, SearchX } from "lucide-react";
import Link from "next/link";

/**
 * What a mistyped address says, in one place.
 *
 * There were two 404s and only one of them was ours. Anything under /rooms got
 * this; anything at the root got Cal's, which is a black marketing page telling
 * the visitor that "the username /whatever is still available" and offering
 * them Cal's documentation and blog. An exhibitor who mistypes a link from an
 * email lands there, and nothing on that screen says NATO Edge or leads back
 * into the booking.
 *
 * Shared rather than copied so the two cannot drift apart again.
 */
export default function NotFoundPanel(): JSX.Element {
  return (
    <div className="mx-auto max-w-md py-12 text-center">
      <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-[#000643]/5 text-[#000643]">
        <SearchX className="h-7 w-7" aria-hidden />
      </div>
      <h1 className="mt-5 font-bold text-2xl text-[#000643]">This page doesn&apos;t exist</h1>
      {/* Wording that holds for both places this appears: a mistyped room slug
          under /rooms, and any address at all outside it. Naming a renamed room
          would be a guess on a link that was simply wrong. */}
      <p className="mt-2 text-gray-600 text-sm">
        This address doesn&apos;t match anything here. Every room on offer is on the listing.
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
