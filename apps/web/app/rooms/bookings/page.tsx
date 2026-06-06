import { getServerSession } from "@calcom/features/auth/lib/getServerSession";
import { getResourceBookingRepository } from "@calcom/features/ne26-rooms/di/ResourceBookingRepository.container";
import { buildLegacyRequest } from "@lib/buildLegacyCtx";
import type { Metadata } from "next";
import { cookies, headers } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";

export const metadata: Metadata = {
  title: "My bookings · NATO Edge 26",
  robots: { index: false, follow: false },
};

const TZ = "Europe/Brussels";
const STATUS_BADGE: Record<string, string> = {
  CONFIRMED: "bg-green-100 text-green-700",
  PENDING: "bg-amber-100 text-amber-700",
  CANCELLED: "bg-gray-100 text-gray-500",
};

function money(cents: number, currency: string): string {
  return new Intl.NumberFormat("en-GB", { style: "currency", currency }).format(cents / 100);
}
function fmt(d: Date): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: TZ,
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(d);
}

export default async function MyBookingsPage(): Promise<JSX.Element> {
  const session = await getServerSession({ req: buildLegacyRequest(await headers(), await cookies()) });
  if (!session?.user?.id) redirect("/rooms/login?callbackUrl=/rooms/bookings");

  const bookings = await getResourceBookingRepository().findByBookerUserIdWithDetails(session.user.id);

  return (
    <div>
      <h1 className="font-bold text-2xl text-[#000643]">My bookings</h1>
      <p className="mt-1 text-gray-600 text-sm">Your meeting room bookings for NATO Edge 26.</p>

      {bookings.length === 0 ? (
        <div className="mt-6 rounded-xl border border-gray-200 bg-white p-6 text-center">
          <p className="text-gray-500 text-sm">You have no bookings yet.</p>
          <Link
            href="/rooms"
            className="mt-3 inline-block rounded-lg bg-[#000643] px-4 py-2 font-semibold text-sm text-white transition hover:opacity-90">
            Book a room
          </Link>
        </div>
      ) : (
        <div className="mt-6 space-y-3">
          {bookings.map((b) => (
            <div
              key={b.uid}
              className="flex flex-col gap-3 rounded-xl border border-gray-200 bg-white p-5 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-semibold text-[#000643]">{b.resource.name}</span>
                  <span
                    className={`inline-block rounded-full px-2 py-0.5 font-medium text-xs ${STATUS_BADGE[b.status] ?? ""}`}>
                    {b.status}
                  </span>
                </div>
                <p className="mt-1 text-gray-600 text-sm">
                  {fmt(b.startTime)} – {fmt(b.endTime)} ({b.durationMinutes / 60}h)
                </p>
                {b.addOns.length > 0 ? (
                  <p className="mt-0.5 text-gray-500 text-xs">
                    {b.addOns.map((a) => `${a.addOn.name}×${a.quantity}`).join(", ")}
                  </p>
                ) : null}
              </div>
              <div className="flex items-center gap-4 sm:flex-col sm:items-end sm:gap-1">
                <span className="font-semibold text-[#000643]">{money(b.amountTotal, b.currency)}</span>
                {b.creditNoteNumber ? (
                  <a
                    href={`/rooms/credit-note/${b.uid}`}
                    target="_blank"
                    rel="noreferrer"
                    className="text-[#000643] text-sm underline hover:opacity-80">
                    Credit note {b.creditNoteNumber}
                  </a>
                ) : b.invoiceNumber ? (
                  <a
                    href={`/rooms/invoice/${b.uid}`}
                    target="_blank"
                    rel="noreferrer"
                    className="text-[#000643] text-sm underline hover:opacity-80">
                    Invoice {b.invoiceNumber}
                  </a>
                ) : (
                  <span className="text-gray-400 text-xs">Awaiting payment</span>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
