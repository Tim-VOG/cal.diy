import { getServerSession } from "@calcom/features/auth/lib/getServerSession";
import { getNe26OrderRepository } from "@calcom/features/ne26-rooms/di/Ne26OrderRepository.container";
import { readInvoicePdf } from "@calcom/features/ne26-rooms/lib/invoiceStorage";
import { buildLegacyRequest } from "@lib/buildLegacyCtx";
import { cookies, headers } from "next/headers";

// Serve a booking's credit-note PDF to its booker or an admin.
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ uid: string }> }
): Promise<Response> {
  const { uid } = await params;
  const session = await getServerSession({ req: buildLegacyRequest(await headers(), await cookies()) });
  if (!session?.user?.id) return new Response("Unauthorized", { status: 401 });

  // Documents belong to the order: one payment covers one or more rooms and
  // produces one invoice.
  const booking = await getNe26OrderRepository().findByUid(uid);
  if (!booking) return new Response("Not found", { status: 404 });

  const isOwner = booking.bookerUserId === session.user.id;
  const isAdmin = session.user.role === "ADMIN";
  if (!isOwner && !isAdmin) return new Response("Forbidden", { status: 403 });

  const pdf = await readInvoicePdf(uid, "credit_note");
  if (!pdf) return new Response("Credit note not available", { status: 404 });

  return new Response(new Uint8Array(pdf), {
    headers: {
      "content-type": "application/pdf",
      "content-disposition": `inline; filename="${booking.creditNoteNumber ?? uid}.pdf"`,
    },
  });
}
