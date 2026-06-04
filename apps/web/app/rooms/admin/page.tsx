import { getServerSession } from "@calcom/features/auth/lib/getServerSession";
import { getResourceBookingRepository } from "@calcom/features/ne26-rooms/di/ResourceBookingRepository.container";
import { buildLegacyRequest } from "@lib/buildLegacyCtx";
import type { Metadata } from "next";
import { cookies, headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import RoomsAdminView from "./RoomsAdminView";

export const metadata: Metadata = {
  title: "Rooms admin · NATO Edge 26",
  robots: { index: false, follow: false },
};

export default async function RoomsAdminPage(): Promise<JSX.Element> {
  // Page-level authorization (never in a layout): admins only.
  const session = await getServerSession({ req: buildLegacyRequest(await headers(), await cookies()) });
  if (!session?.user?.id) redirect("/rooms/login?callbackUrl=/rooms/admin");
  if (session.user.role !== "ADMIN") notFound();

  const bookings = await getResourceBookingRepository().findAllWithDetails();
  const rows = bookings.map((b) => ({
    uid: b.uid,
    status: b.status,
    roomName: b.resource.name,
    category: b.resource.category,
    startUtc: b.startTime.toISOString(),
    endUtc: b.endTime.toISOString(),
    durationMinutes: b.durationMinutes,
    bookerName: b.bookerName,
    bookerEmail: b.bookerEmail,
    amountTotal: b.amountTotal,
    currency: b.currency,
    stripePaymentId: b.stripePaymentId,
    invoiceNumber: b.invoiceNumber,
    creditNoteNumber: b.creditNoteNumber,
    addOns: b.addOns.map((a) => ({ name: a.addOn.name, quantity: a.quantity, lineTotal: a.lineTotal })),
  }));

  return <RoomsAdminView rows={rows} />;
}
