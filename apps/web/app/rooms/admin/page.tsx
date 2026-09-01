import { getServerSession } from "@calcom/features/auth/lib/getServerSession";
import { getInvoiceSettingsRepository } from "@calcom/features/ne26-rooms/di/InvoiceSettingsRepository.container";
import { getNe26RoomSettingsRepository } from "@calcom/features/ne26-rooms/di/Ne26RoomSettingsRepository.container";
import { getResourceBookingRepository } from "@calcom/features/ne26-rooms/di/ResourceBookingRepository.container";
import { getResourceRepository } from "@calcom/features/ne26-rooms/di/ResourceRepository.container";
import { buildLegacyRequest } from "@lib/buildLegacyCtx";
import type { Metadata } from "next";
import { cookies, headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import ConfigHealth from "./ConfigHealth";
import RoomsAdminView from "./RoomsAdminView";
import { requireNotDeskMode } from "./requireNotDeskMode";

export const metadata: Metadata = {
  title: "Rooms admin · NATO Edge 26",
  robots: { index: false, follow: false },
};

export default async function RoomsAdminPage(): Promise<JSX.Element> {
  // Page-level authorization (never in a layout): admins only.
  const session = await getServerSession({ req: buildLegacyRequest(await headers(), await cookies()) });
  if (!session?.user?.id) redirect("/rooms/login?callbackUrl=/rooms/admin");
  if (session.user.role !== "ADMIN") notFound();
  await requireNotDeskMode();

  // Drop abandoned, unpaid bookings whose hold expired before listing.
  await getResourceBookingRepository().deleteExpiredHolds(new Date());
  const [bookings, allRooms, roomSettings, settings] = await Promise.all([
    getResourceBookingRepository().findAllWithDetails(),
    getResourceRepository().findAllForAdmin(),
    getNe26RoomSettingsRepository().get(),
    getInvoiceSettingsRepository().get(),
  ]);
  const roomNames = allRooms.filter((r) => r.isActive).map((r) => r.name);
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
    stripePaymentId: b.order?.stripePaymentId ?? b.stripePaymentId,
    // The document belongs to the order this room was paid for. Bookings taken
    // before orders existed carry theirs on the row instead, and those are real
    // invoices — falling through to them keeps the admin honest rather than
    // showing a dash next to a document that was issued and emailed.
    orderUid: b.order?.uid ?? null,
    orderRoomCount: b.order?._count.bookings ?? 1,
    invoiceNumber: b.order?.invoiceNumber ?? b.invoiceNumber,
    creditNoteNumber: b.order?.creditNoteNumber ?? b.creditNoteNumber,
    addOns: b.addOns.map((a) => ({ name: a.addOn.name, quantity: a.quantity, lineTotal: a.lineTotal })),
  }));

  return (
    <>
      <ConfigHealth
        settings={{ notifyEmails: settings.notifyEmails, contactEmail: settings.contactEmail }}
      />
      <RoomsAdminView
        rows={rows}
        roomNames={roomNames}
        slotGranularityMinutes={roomSettings.slotGranularityMinutes}
        eventDays={roomSettings.eventDays}
      />
    </>
  );
}
