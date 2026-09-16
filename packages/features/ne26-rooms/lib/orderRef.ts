/**
 * The order number people read, say and search for: "NE26-ORD-0042".
 *
 * Orders were identified by a uuid, or by their invoice number once one
 * existed — so an unpaid hold, or a paid order whose invoice failed, carried
 * nothing a person could quote. The number comes from the database
 * (Ne26Order.orderNumber), assigned at creation.
 *
 * "ORD" rather than a bare number so it can never be mistaken for an invoice
 * (NE26-2026-0042) or a credit note (NE26-CN-2026-0042) that happen to share
 * the same digits — which, for the first orders of the event, they will.
 */
export function orderRef(orderNumber: number): string {
  return `NE26-ORD-${String(orderNumber).padStart(4, "0")}`;
}
