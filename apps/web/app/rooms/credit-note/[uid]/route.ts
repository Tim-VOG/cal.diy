import { getServerSession } from "@calcom/features/auth/lib/getServerSession";
import { getNe26OrderRepository } from "@calcom/features/ne26-rooms/di/Ne26OrderRepository.container";
import { getResourceBookingRepository } from "@calcom/features/ne26-rooms/di/ResourceBookingRepository.container";
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
  // produces one invoice. A document issued before orders existed was stored
  // under its booking's uid, so fall through to the booking — otherwise every
  // invoice already emailed to an exhibitor would 404 on the link they were
  // sent, with the PDF sitting on disk the whole time.
  const document =
    (await getNe26OrderRepository().findByUid(uid)) ??
    (await getResourceBookingRepository().findByUid(uid));
  if (!document) return new Response("Not found", { status: 404 });

  const isOwner = document.bookerUserId === session.user.id;
  const isAdmin = session.user.role === "ADMIN";
  if (!isOwner && !isAdmin) return new Response("Forbidden", { status: 403 });

  const pdf = await readInvoicePdf(uid, "credit_note");
  if (!pdf) return new Response("Credit note not available", { status: 404 });

  return new Response(new Uint8Array(pdf), {
    headers: {
      "content-type": "application/pdf",
      "content-disposition": `inline; filename="${document.creditNoteNumber ?? uid}.pdf"`,
    },
  });
}
