/**
 * Which invoice and credit note a booked room belongs to, and under which uid
 * their PDFs are stored.
 *
 * Documents belong to the ORDER: one payment can cover several rooms and issues
 * one invoice. Bookings taken before orders existed carry theirs on the room
 * row instead, and those are real documents that were emailed — so the order
 * wins and the room is the fallback, never the other way round.
 *
 * Written once because it had been written three times and got wrong once: the
 * Bookers tab read only the room row, so every sale made through an order showed
 * no invoice at all, and its links pointed at the room's uid, where no PDF is
 * stored.
 */

export interface DocumentSource {
  uid: string;
  invoiceNumber?: string | null;
  creditNoteNumber?: string | null;
  order?: { uid: string; invoiceNumber: string | null; creditNoteNumber: string | null } | null;
}

export interface BookingDocuments {
  /** The uid the /rooms/invoice and /rooms/credit-note routes look the PDF up by. */
  documentUid: string;
  invoiceNumber: string | null;
  creditNoteNumber: string | null;
}

export function bookingDocuments(booking: DocumentSource): BookingDocuments {
  const { order } = booking;
  if (order && (order.invoiceNumber || order.creditNoteNumber)) {
    return {
      documentUid: order.uid,
      invoiceNumber: order.invoiceNumber,
      creditNoteNumber: order.creditNoteNumber,
    };
  }
  if (booking.invoiceNumber || booking.creditNoteNumber) {
    return {
      documentUid: booking.uid,
      invoiceNumber: booking.invoiceNumber ?? null,
      creditNoteNumber: booking.creditNoteNumber ?? null,
    };
  }
  // Nothing issued yet: when something is, it will be on the order.
  return { documentUid: order?.uid ?? booking.uid, invoiceNumber: null, creditNoteNumber: null };
}
