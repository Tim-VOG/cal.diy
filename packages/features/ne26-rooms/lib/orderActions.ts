/**
 * Which admin actions an order is actually eligible for.
 *
 * Pulled out of the button markup because the conditions are not decoration:
 * offering "issue the missing invoice" on an order that holds no rooms would
 * produce an invoice for nothing and spend a document number on it, and
 * offering "close this order" on one that still holds a room would strand the
 * room — CANCELLED on the order, still PENDING and still unsellable on the
 * booking. Both are wrong in a way nobody notices until the accounts are done.
 *
 * The server guards each of these independently; this is what the screen offers,
 * and the two agreeing is what stops an admin being handed a button that fails.
 */

export interface OrderState {
  status: string;
  hasInvoice: boolean;
  hasCreditNote: boolean;
  /** Rooms still attached. Zero is the case this module exists for. */
  roomCount: number;
  /**
   * Whether Stripe captured money for this order. Required rather than
   * defaulted: a caller that forgot it would silently be offered "delete" on a
   * paid order.
   */
  paid: boolean;
}

export interface OrderActions {
  /** Mark a hold paid without Stripe (money arrived by transfer). */
  confirmManually: boolean;
  /** Cancel a hold and free its rooms. */
  cancelPending: boolean;
  /** Close an order that holds nothing, once settled elsewhere. */
  closeSettled: boolean;
  /** Issue an invoice that never came out. */
  issueInvoice: boolean;
  /** Re-send the invoice email. */
  resendInvoice: boolean;
  /** Credit and cancel a paid, invoiced order. */
  issueCreditNote: boolean;
  /** Delete it outright — only while no document refers to it. */
  deleteOrder: boolean;
}

export function availableOrderActions(order: OrderState): OrderActions {
  const holdsRooms = order.roomCount > 0;
  const pending = order.status === "PENDING";
  const confirmed = order.status === "CONFIRMED";

  return {
    // Both of these act on rooms. With none left there is nothing to confirm
    // and nothing to free; confirmPaid refuses this outright (NoRoomsToConfirm)
    // rather than record a sale of nothing, so the button would only ever fail.
    confirmManually: pending && holdsRooms,
    cancelPending: pending && holdsRooms,

    // The counterpart for an order holding nothing. Never offered while a room
    // is attached: that is what cancelPending is for, and it frees the room.
    closeSettled: pending && !holdsRooms,

    // Paid, but the invoice never came out — the PDF render or the disk write
    // failed and the webhook only logged it. Requires rooms: an invoice listing
    // no rooms is not a recovery, it is a second problem.
    issueInvoice: confirmed && !order.hasInvoice && holdsRooms,

    // Reads the stored PDF, so it needs one to have been issued. Independent of
    // rooms — a credited order can still have its paperwork re-sent.
    resendInvoice: order.hasInvoice,

    // Crediting needs something to credit and must not happen twice.
    issueCreditNote: confirmed && order.hasInvoice && !order.hasCreditNote,

    // Deleting is for a booking that never became anything — a test, a mistake.
    // Never once a document refers to it: an invoice is undone with a credit
    // note, not by removing what it points at. Not offered for a live hold
    // either, where cancelPending says what it does and says it better.
    //
    // And never once money is involved. "No invoice" was the only test, which
    // offered delete on a CONFIRMED order whose invoice had failed — the very
    // case "issue the missing invoice" exists to repair. One click would have
    // erased the only record, on this side, of a payment Stripe still holds.
    // A confirmed order without an invoice is always a sale owed its paperwork,
    // and a captured payment on anything else is money to refund, not a row to
    // tidy away.
    deleteOrder: !order.hasInvoice && !order.hasCreditNote && !pending && !confirmed && !order.paid,
  };
}

/** True when the screen has nothing to offer, so it can say so plainly. */
export function hasNoActions(actions: OrderActions): boolean {
  return !Object.values(actions).some(Boolean);
}

export interface UnavailableAction {
  label: string;
  reason: string;
}

/**
 * Why each action that is NOT offered is missing, in the desk's words.
 *
 * A button that is simply absent makes people hunt for it — "where did Delete
 * go?" — and the answer is always the same few rules. Saying them next to the
 * actions that are offered ends the hunt. The reasons mirror the conditions in
 * availableOrderActions one for one, so they can never describe a rule the
 * buttons do not follow.
 */
export function explainUnavailableActions(order: OrderState): UnavailableAction[] {
  const can = availableOrderActions(order);
  const pending = order.status === "PENDING";
  const confirmed = order.status === "CONFIRMED";
  const holdsRooms = order.roomCount > 0;
  const out: UnavailableAction[] = [];

  if (!can.confirmManually) {
    out.push({
      label: "Mark as paid manually",
      reason: !pending ? "only for an order awaiting payment" : "no room left to confirm",
    });
  }
  if (!can.issueInvoice && !order.hasInvoice) {
    out.push({
      label: "Issue the missing invoice",
      reason: !confirmed ? "the order is not paid" : "no room left to invoice",
    });
  }
  if (!can.resendInvoice) {
    out.push({ label: "Resend invoice email", reason: "needs an invoice" });
  }
  if (!can.issueCreditNote && !order.hasCreditNote) {
    out.push({
      label: "Issue credit note",
      reason: !order.hasInvoice ? "needs an invoice" : "only for a confirmed order",
    });
  }
  if (!can.deleteOrder) {
    out.push({
      label: "Delete order",
      reason:
        order.hasInvoice || order.hasCreditNote
          ? "a document refers to it"
          : order.paid || confirmed
            ? "never for a paid order"
            : pending && holdsRooms
              ? "cancel the hold instead"
              : "not available",
    });
  }
  return out;
}
