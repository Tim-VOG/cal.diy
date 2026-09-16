import { getServerSession } from "@calcom/features/auth/lib/getServerSession";
import { getResourceBookingRepository } from "@calcom/features/ne26-rooms/di/ResourceBookingRepository.container";
import { buildOrderIcs } from "@calcom/features/ne26-rooms/lib/ics";
import { buildLegacyRequest } from "@lib/buildLegacyCtx";
import { cookies, headers } from "next/headers";

/**
 * The signed-in exhibitor's confirmed rooms as a calendar file.
 *
 * It only ever existed as an attachment to the confirmation email, so anyone
 * who deleted that email, or booked on a phone and wanted the meeting on a
 * laptop, had no way to get it back. `?booking=<uid>` narrows it to one room.
 *
 * Only the exhibitor's own bookings, only confirmed ones: a hold is not yet a
 * meeting, and putting it in a calendar would outlive the 35 minutes it lasts.
 */
export async function GET(req: Request): Promise<Response> {
  const session = await getServerSession({ req: buildLegacyRequest(await headers(), await cookies()) });
  if (!session?.user?.id) return new Response("Unauthorized", { status: 401 });

  const only = new URL(req.url).searchParams.get("booking");
  const bookings = (
    await getResourceBookingRepository().findByBookerUserIdWithDetails(session.user.id)
  ).filter((b) => b.status === "CONFIRMED" && (!only || b.uid === only));
  if (bookings.length === 0) return new Response("No confirmed booking to add", { status: 404 });

  const ics = buildOrderIcs(
    bookings.map((b) => ({ uid: b.uid, roomName: b.resource.name, startUtc: b.startTime, endUtc: b.endTime }))
  );
  const name = only
    ? `ne26-${bookings[0].resource.name.toLowerCase().replace(/\s+/g, "-")}`
    : "ne26-meeting-rooms";
  return new Response(ics, {
    headers: {
      "content-type": "text/calendar; charset=utf-8",
      "content-disposition": `attachment; filename="${name}.ics"`,
      "cache-control": "private, no-store",
    },
  });
}
