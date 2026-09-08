"use client";

import { availableOrderActions, hasNoActions } from "@calcom/features/ne26-rooms/lib/orderActions";
import { trpc } from "@calcom/trpc/react";
import { useRouter } from "next/navigation";

const btnBase = "rounded-lg px-4 py-2 font-semibold text-sm transition disabled:opacity-40";

/**
 * Every action here addresses the ORDER, never the room: one payment can cover
 * several rooms and issues one invoice, so confirming, cancelling or crediting
 * half of it would leave the rest stranded. `roomCount` is what the
 * confirmations say out loud, so an admin crediting from one room's page knows
 * how many rooms go with it.
 *
 * roomCount can be zero — that is the order page's case, an order whose rooms
 * are gone — and it changes which actions are honest: nothing to confirm and
 * nothing to invoice, because there is nothing left to sell.
 *
 * Which buttons appear is decided by availableOrderActions, which is unit-tested
 * over every combination. The conditions are not decoration: an invoice issued
 * for an order with no rooms spends a number in a gapless series on a document
 * listing nothing, and a close on an order that still holds a room strands it.
 */
export default function BookingActions({
  orderUid,
  status,
  hasInvoice,
  hasCreditNote,
  roomCount,
  paid = false,
}: {
  orderUid: string;
  status: string;
  hasInvoice: boolean;
  hasCreditNote: boolean;
  roomCount: number;
  /** Whether Stripe captured money for this order. Only asked when roomCount is 0. */
  paid?: boolean;
}): JSX.Element {
  const router = useRouter();
  const refresh = { onSuccess: () => router.refresh() };
  const confirmManually = trpc.viewer.rooms.confirmBookingManually.useMutation(refresh);
  const cancelPending = trpc.viewer.rooms.cancelPendingBooking.useMutation(refresh);
  const creditNote = trpc.viewer.rooms.issueCreditNote.useMutation(refresh);
  const resend = trpc.viewer.rooms.resendInvoice.useMutation();
  const issueInvoice = trpc.viewer.rooms.issueInvoice.useMutation(refresh);
  const closeOrder = trpc.viewer.rooms.closeSettledOrder.useMutation(refresh);
  const deleteOrder = trpc.viewer.rooms.deleteOrder.useMutation({
    // Nothing left to show: the order is gone, so go back to the list.
    onSuccess: () => {
      router.push("/rooms/admin");
      router.refresh();
    },
  });

  const can = availableOrderActions({ status, hasInvoice, hasCreditNote, roomCount });

  const busy =
    confirmManually.isPending ||
    cancelPending.isPending ||
    creditNote.isPending ||
    resend.isPending ||
    issueInvoice.isPending ||
    closeOrder.isPending ||
    deleteOrder.isPending;

  const error =
    confirmManually.error ??
    cancelPending.error ??
    creditNote.error ??
    resend.error ??
    issueInvoice.error ??
    closeOrder.error ??
    deleteOrder.error;

  const rooms = roomCount === 0 ? "this order" : roomCount > 1 ? `these ${roomCount} rooms` : "this room";

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-5">
      <h2 className="font-semibold text-gray-500 text-xs uppercase tracking-wide">Actions</h2>
      <div className="mt-3 flex flex-wrap gap-2">
        {can.confirmManually ? (
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              if (
                window.confirm(
                  `Mark the order for ${rooms} as paid without going through Stripe? One invoice will be issued for the whole order. Only do this if you have confirmed the money another way — nothing is charged here.`
                )
              ) {
                confirmManually.mutate({ uid: orderUid });
              }
            }}
            className={`${btnBase} bg-[#000643] text-white hover:opacity-90`}>
            {confirmManually.isPending ? "Confirming…" : "Mark as paid manually"}
          </button>
        ) : null}

        {can.cancelPending ? (
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              if (window.confirm(`Cancel this pending order and free ${rooms}? No credit note is issued.`)) {
                cancelPending.mutate({ uid: orderUid });
              }
            }}
            className={`${btnBase} border border-red-200 text-red-600 hover:border-red-400`}>
            {cancelPending.isPending ? "Cancelling…" : `Cancel order (${rooms})`}
          </button>
        ) : null}

        {/* Nothing to sell and nothing to give back: the rooms went back on sale
            and may already belong to someone else. The refund happens in Stripe,
            by a person; this only records that it was dealt with, so the
            dashboard's red panel stops crying wolf for the rest of the event.
            The row keeps its payment id and its amount either way. */}
        {can.closeSettled ? (
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              if (
                window.confirm(
                  paid
                    ? "Close this order? Do this only once the payment has been refunded in Stripe and the buyer has been told. Nothing is refunded from here — the order is marked settled so it stops being flagged."
                    : "Close this abandoned checkout? It holds no rooms and took no money."
                )
              ) {
                closeOrder.mutate({ uid: orderUid });
              }
            }}
            className={`${btnBase} border border-gray-300 text-gray-700 hover:border-gray-500`}>
            {closeOrder.isPending ? "Closing…" : paid ? "Refunded in Stripe — close order" : "Close order"}
          </button>
        ) : null}

        {/* Paid, but the invoice never came out — the PDF render or the disk
            write failed and the webhook only logged it. Until this button
            existed the order was a dead end: it could not be invoiced, could not
            be credited (that needs an invoice number) and could not be cancelled
            (that path is PENDING-only), so its rooms stayed held until somebody
            edited the database by hand. issueInvoice is idempotent. */}
        {can.issueInvoice ? (
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              if (
                window.confirm(
                  `Issue the missing invoice for ${rooms}? This spends the next invoice number and emails the booker. Safe to retry — it will not issue a second one.`
                )
              ) {
                issueInvoice.mutate({ uid: orderUid });
              }
            }}
            className={`${btnBase} bg-[#000643] text-white hover:opacity-90`}>
            {issueInvoice.isPending ? "Issuing…" : "Issue the missing invoice"}
          </button>
        ) : null}

        {can.resendInvoice ? (
          <button
            type="button"
            disabled={busy}
            onClick={() => resend.mutate({ uid: orderUid })}
            className={`${btnBase} border border-gray-200 text-[#000643] hover:border-[#000643]`}>
            {resend.isPending ? "Sending…" : "Resend invoice email"}
          </button>
        ) : null}

        {can.issueCreditNote ? (
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              if (
                window.confirm(
                  `Issue a credit note for the whole order? This cancels ${rooms}, frees the slots, and emails the booker. Refund the payment in Stripe separately.`
                )
              ) {
                creditNote.mutate({ uid: orderUid });
              }
            }}
            className={`${btnBase} border border-red-200 text-red-600 hover:border-red-400`}>
            {creditNote.isPending ? "Issuing…" : "Issue credit note"}
          </button>
        ) : null}

        {/* For a test booking, or one that never became anything. Kept away
            from the other buttons and worded so it cannot be misread: this
            removes the record, where every other action here preserves it. */}
        {can.deleteOrder ? (
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              if (
                window.confirm(
                  `Delete this order permanently? ${
                    roomCount > 0
                      ? `${roomCount === 1 ? "The room goes" : `The ${roomCount} rooms go`} back on sale. `
                      : ""
                  }Nothing is kept — use this for a test or a mistake, not for a booking that was invoiced.`
                )
              ) {
                deleteOrder.mutate({ uid: orderUid });
              }
            }}
            className={`${btnBase} border border-red-300 bg-red-50 text-red-700 hover:bg-red-100`}>
            {deleteOrder.isPending ? "Deleting…" : "Delete order"}
          </button>
        ) : null}

        {hasNoActions(can) ? (
          <p className="text-gray-400 text-sm">
            {roomCount === 0 && status === "CONFIRMED"
              ? "This order is confirmed but holds no rooms and has no invoice. Nothing here can settle it — reconcile it in Stripe."
              : "No actions available for this order."}
          </p>
        ) : null}
      </div>

      {closeOrder.isSuccess ? (
        <p className="mt-2 text-green-600 text-sm">
          {closeOrder.data?.closed
            ? "Order closed ✓"
            : "Not closed — it is no longer pending, or it holds a room."}
        </p>
      ) : null}
      {issueInvoice.isSuccess ? (
        <p className="mt-2 text-green-600 text-sm">
          {issueInvoice.data?.issued ? "Invoice issued and emailed ✓" : "No invoice was issued."}
        </p>
      ) : null}
      {resend.isSuccess ? (
        <p className="mt-2 text-green-600 text-sm">
          {resend.data?.sent ? "Invoice email sent ✓" : "No invoice to send."}
        </p>
      ) : null}
      {error ? <p className="mt-2 text-red-600 text-sm">{error.message}</p> : null}
    </div>
  );
}
