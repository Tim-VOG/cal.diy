import { getServerSession } from "@calcom/features/auth/lib/getServerSession";
import { getResourceBookingRepository } from "@calcom/features/ne26-rooms/di/ResourceBookingRepository.container";
import { buildLegacyRequest } from "@lib/buildLegacyCtx";
import { CheckCircle2, Clock } from "lucide-react";
import type { Metadata } from "next";
import { cookies, headers } from "next/headers";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";

type Params = Promise<{ uid: string }>;

export const metadata: Metadata = { title: "Booking confirmation · NATO Edge 26" };

const TZ = "Europe/Brussels";

function formatRange(start: Date, end: Date): string {
  const day = new Intl.DateTimeFormat("en-GB", {
    timeZone: TZ,
    weekday: "short",
    day: "numeric",
    month: "short",
  }).format(start);
  const time = (d: Date) =>
    new Intl.DateTimeFormat("en-GB", {
      timeZone: TZ,
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).format(d);
  return `${day}, ${time(start)} – ${time(end)}`;
}

export default async function BookedPage({ params }: { params: Params }): Promise<JSX.Element> {
  const { uid } = await params;
  const session = await getServerSession({ req: buildLegacyRequest(await headers(), await cookies()) });
  if (!session?.user?.id) redirect(`/rooms/login?callbackUrl=/rooms/booked/${uid}`);

  const booking = await getResourceBookingRepository().findByUid(uid);
  if (!booking) notFound();
  // Only the booker (or an admin) can see a booking's confirmation.
  if (booking.bookerUserId !== session.user.id && session.user.role !== "ADMIN") notFound();

  const isConfirmed = booking.status === "CONFIRMED";
  const amount = new Intl.NumberFormat("en-GB", { style: "currency", currency: booking.currency }).format(
    booking.amountTotal / 100
  );

  return (
    <div className="mx-auto max-w-lg rounded-xl border border-gray-200 bg-white p-8 text-center shadow-sm">
      {isConfirmed ? (
        <CheckCircle2 className="mx-auto h-12 w-12 text-green-600" aria-hidden />
      ) : (
        <Clock className="mx-auto h-12 w-12 text-[#000643]" aria-hidden />
      )}
      <h1 className="mt-4 font-bold text-2xl text-[#000643]">
        {isConfirmed ? "Booking confirmed" : "Finalising your payment…"}
      </h1>
      <p className="mt-2 text-gray-600 text-sm">
        {isConfirmed
          ? "Your payment was received and the room is reserved."
          : "We're confirming your payment with Stripe. This page will reflect the final status shortly."}
      </p>

      <div className="mt-6 space-y-1 rounded-lg bg-gray-50 p-4 text-left text-sm">
        <p className="font-semibold">{booking.resource.name}</p>
        <p>{formatRange(booking.startTime, booking.endTime)}</p>
        <p className="font-bold text-[#000643]">{amount}</p>
        <p className="text-gray-500 text-xs">Reference {booking.uid.slice(0, 8)}</p>
      </div>

      <Link
        href="/rooms"
        className="mt-6 inline-block rounded-lg bg-[#000643] px-4 py-2.5 font-semibold text-sm text-white transition hover:opacity-90">
        Back to rooms
      </Link>
    </div>
  );
}
