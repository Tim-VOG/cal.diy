/**
 * A short handle for an order that has no invoice number yet.
 *
 * The bookings list identified an order only by its invoice number, so the
 * rows of an unpaid hold — or of a paid order whose invoice failed, the case
 * "issue the missing invoice" exists for — carried no identifier at all. Two
 * rooms of the same order could not be told from two separate bookings, and
 * the one order that needed repairing was the one nobody could find.
 *
 * The first block of the uid: eight hex characters, enough to be unique across
 * a few hundred orders and short enough to read out over the phone. It is a
 * prefix of the full uid shown on the order page, so the two visibly match.
 */
export function orderRef(orderUid: string): string {
  return `#${orderUid.split("-")[0].slice(0, 8)}`;
}
