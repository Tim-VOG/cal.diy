import { getServerSession } from "@calcom/features/auth/lib/getServerSession";
import { getResourceBookingRepository } from "@calcom/features/ne26-rooms/di/ResourceBookingRepository.container";
import { readInvoicePdf } from "@calcom/features/ne26-rooms/lib/invoiceStorage";
import { buildLegacyRequest } from "@lib/buildLegacyCtx";
import { cookies, headers } from "next/headers";

// Serve a booking's invoice PDF to its booker or an admin.
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ uid: string }> }
): Promise<Response> {
  const { uid } = await params;
  const session = await getServerSession({ req: buildLegacyRequest(await headers(), await cookies()) });
  if (!session?.user?.id) return new Response("Unauthorized", { status: 401 });

  const booking = await getResourceBookingRepository().findByUid(uid);
  if (!booking) return new Response("Not found", { status: 404 });

  const isOwner = booking.bookerUserId === session.user.id;
  const isAdmin = session.user.role === "ADMIN";
  if (!isOwner && !isAdmin) return new Response("Forbidden", { status: 403 });

  const pdf = await readInvoicePdf(uid);
  if (!pdf) return new Response("Invoice not available yet", { status: 404 });

  return new Response(new Uint8Array(pdf), {
    headers: {
      "content-type": "application/pdf",
      "content-disposition": `inline; filename="${booking.invoiceNumber ?? uid}.pdf"`,
    },
  });
}
