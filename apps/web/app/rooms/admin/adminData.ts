import "server-only";

import { getInvoiceSettingsRepository } from "@calcom/features/ne26-rooms/di/InvoiceSettingsRepository.container";
import { getNe26OrderRepository } from "@calcom/features/ne26-rooms/di/Ne26OrderRepository.container";
import { getNe26RoomSettingsRepository } from "@calcom/features/ne26-rooms/di/Ne26RoomSettingsRepository.container";
import { getResourceBookingRepository } from "@calcom/features/ne26-rooms/di/ResourceBookingRepository.container";
import { getResourceRepository } from "@calcom/features/ne26-rooms/di/ResourceRepository.container";
import { bookingDocuments } from "@calcom/features/ne26-rooms/lib/bookingDocuments";
import { checkNe26ConfigFromProcess } from "@calcom/features/ne26-rooms/lib/configCheck";
import { needsAttention } from "@calcom/features/ne26-rooms/lib/needsAttention";
import type { AdminBookingRow } from "./RoomsAdminView";

/**
 * Everything the bookings dashboard reads, loaded in one place.
 *
 * The navigation needs the same "needs attention" list as the page, to light
 * its counter, and two copies of this loading would drift the day one gained a
 * field. Admin-only by contract: callers check the session first.
 */
export async function loadAdminBookings() {
  // Drop abandoned, unpaid bookings whose hold expired before listing.
  await getResourceBookingRepository().deleteExpiredHolds(new Date());

  const [bookings, allRooms, roomSettings, settings, orphanOrders, blocks] = await Promise.all([
    getResourceBookingRepository().findAllWithDetails(),
    getResourceRepository().findAllForAdmin(),
    getNe26RoomSettingsRepository().get(),
    getInvoiceSettingsRepository().get(),
    // An order whose rooms are gone appears nowhere in a list of rooms.
    getNe26OrderRepository().findOrdersWithoutRooms(),
    getResourceBookingRepository().findBlocks(),
  ]);

  const rows: AdminBookingRow[] = bookings.map((b) => {
    const docs = bookingDocuments(b);
    return {
      uid: b.uid,
      status: b.status,
      roomName: b.resource.name,
      category: b.resource.category,
      startUtc: b.startTime.toISOString(),
      endUtc: b.endTime.toISOString(),
      durationMinutes: b.durationMinutes,
      // The order's booker, falling back to the room's: what the invoice says.
      bookerName: b.order?.bookerName || b.bookerName,
      bookerEmail: b.order?.bookerEmail || b.bookerEmail,
      amountTotal: b.amountTotal,
      currency: b.currency,
      stripePaymentId: b.order?.stripePaymentId ?? b.stripePaymentId,
      orderUid: b.order?.uid ?? null,
      orderNumber: b.order?.orderNumber ?? null,
      orderRoomCount: b.order?._count.bookings ?? 1,
      orderedAt: (b.order?.createdAt ?? b.createdAt).toISOString(),
      paidAt: b.order?.paidAt?.toISOString() ?? null,
      holdExpiresAt: b.holdExpiresAt?.toISOString() ?? null,
      documentUid: docs.documentUid,
      invoiceNumber: docs.invoiceNumber,
      creditNoteNumber: docs.creditNoteNumber,
      addOns: b.addOns.map((a) => ({ name: a.addOn.name, quantity: a.quantity, lineTotal: a.lineTotal })),
    };
  });

  const configIssues = checkNe26ConfigFromProcess({
    notifyEmails: settings.notifyEmails,
    contactEmail: settings.contactEmail,
  });

  const attention = needsAttention({
    now: new Date(),
    orphanOrders,
    bookings: rows,
    configIssues,
  });

  return {
    rows,
    roomNames: allRooms.filter((r) => r.isActive).map((r) => r.name),
    rooms: allRooms
      .filter((r) => r.isActive)
      .map((r) => ({ name: r.name, category: r.category, capacity: r.capacity })),
    roomSettings,
    orphanOrders,
    blocks: blocks.map((b) => ({
      uid: b.uid,
      roomName: b.resource.name,
      startUtc: b.startTime.toISOString(),
      endUtc: b.endTime.toISOString(),
    })),
    attention,
  };
}
