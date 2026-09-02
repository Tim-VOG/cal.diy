import { getServerSession } from "@calcom/features/auth/lib/getServerSession";
import { getNe26OrderRepository } from "@calcom/features/ne26-rooms/di/Ne26OrderRepository.container";
import { getResourceBookingRepository } from "@calcom/features/ne26-rooms/di/ResourceBookingRepository.container";
import { buildLegacyRequest } from "@lib/buildLegacyCtx";
import { CheckCircle2, Clock } from "lucide-react";
import type { Metadata } from "next";
import { cookies, headers } from "next/headers";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { EVENT_TIME_ZONE } from "@calcom/features/ne26-rooms/lib/eventSchedule";
import ClearShortlist from "./ClearShortlist";

type Params = Promise<{ uid: string }>;

export const metadata: Metadata = { title: "Booking confirmation · NATO Edge 26" };

const TZ = EVENT_TIME_ZONE;

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

  // Stripe returns the buyer here with the ORDER uid, and an order may cover
  // several rooms. This page used to look the id up as a single booking, so
  // every successful payment landed on "This page doesn't exist" — the last
  // thing an exhibitor saw after handing over their card. The booking lookup is
  // kept as a fallback: links in mails sent before this fix carry that id.
  const order = await getNe26OrderRepository().findByUid(uid);
  const booking = order ? null : await getResourceBookingRepository().findByUid(uid);
  const found = order ?? booking;
  if (!found) notFound();
  // Only the booker (or an admin) may see a confirmation.
  if (found.bookerUserId !== session.user.id && session.user.role !== "ADMIN") notFound();

  const rooms = order
    ? order.bookings.map((b) => ({
        name: b.resource.name,
        startTime: b.startTime,
        endTime: b.endTime,
      }))
    : [
        {
          name: (booking as NonNullable<typeof booking>).resource.name,
          startTime: (booking as NonNullable<typeof booking>).startTime,
          endTime: (booking as NonNullable<typeof booking>).endTime,
        },
      ];

  const isConfirmed = found.status === "CONFIRMED";
  const amount = new Intl.NumberFormat("en-GB", { style: "currency", currency: found.currency }).format(
    found.amountTotal / 100
  );

  return (
    <div className="mx-auto max-w-lg rounded-xl border border-gray-200 bg-white p-8 text-center shadow-sm">
      <ClearShortlist />
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
          ? rooms.length === 1
            ? "Your payment was received and the room is reserved."
            : "Your payment was received and the rooms are reserved."
          : "We're confirming your payment with Stripe. This page will reflect the final status shortly."}
      </p>

      <div className="mt-6 space-y-3 rounded-lg bg-gray-50 p-4 text-left text-sm">
        {rooms.map((r) => (
          <div key={`${r.name}-${r.startTime.toISOString()}`}>
            <p className="font-semibold">{r.name}</p>
            <p>{formatRange(r.startTime, r.endTime)}</p>
          </div>
        ))}
        <p className="border-gray-200 border-t pt-3 font-bold text-[#000643]">
          {amount} <span className="font-normal text-gray-500 text-xs">excl. VAT</span>
        </p>
        <p className="text-gray-500 text-xs">Reference {uid.slice(0, 8)}</p>
      </div>

      <Link
        href="/rooms"
        className="mt-6 inline-block rounded-lg bg-[#000643] px-4 py-2.5 font-semibold text-sm text-white transition hover:opacity-90">
        Back to rooms
      </Link>
    </div>
  );
}
