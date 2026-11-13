"use client";

import {
  availableOrderActions,
  explainUnavailableActions,
  hasNoActions,
} from "@calcom/features/ne26-rooms/lib/orderActions";
import { trpc } from "@calcom/trpc/react";
import { useRouter } from "next/navigation";
import { useState } from "react";

const btnBase =
  "inline-flex w-full items-center justify-center rounded-lg px-3 py-2 font-semibold text-[13px] transition disabled:opacity-40";

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
  paid,
  variant = "panel",
}: {
  orderUid: string;
  status: string;
  hasInvoice: boolean;
  hasCreditNote: boolean;
  roomCount: number;
  /**
   * Whether Stripe captured money for this order. Required: it decides whether
   * delete is offered at all, and a forgotten prop defaulting to "unpaid" is how
   * a paid order gets a delete button.
   */
  paid: boolean;
  /**
   * "panel" sits inside the booking panel beside the plan; "rail" is the order
   * page's own column, which has room to say why the other actions are missing.
   */
  variant?: "panel" | "rail";
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

  const can = availableOrderActions({ status, hasInvoice, hasCreditNote, roomCount, paid });
  const unavailable =
    variant === "rail"
      ? explainUnavailableActions({ status, hasInvoice, hasCreditNote, roomCount, paid })
      : [];

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
    <div className={variant === "rail" ? "rounded-xl border border-gray-200 bg-white p-4" : ""}>
      <h2 className="font-semibold text-[11px] text-gray-500 uppercase tracking-[0.07em]">Actions</h2>
      <div className="mt-2.5 grid gap-2">
        {can.confirmManually ? (
          <ConfirmAction
            label="Mark as paid manually"
            busyLabel="Confirming…"
            pending={confirmManually.isPending}
            disabled={busy}
            tone="primary"
            question={`Mark the order for ${rooms} as paid without going through Stripe? One invoice will be issued for the whole order. Only do this if you have confirmed the money another way — nothing is charged here.`}
            confirmLabel="Yes, mark it paid"
            onConfirm={() => confirmManually.mutate({ uid: orderUid })}
          />
        ) : null}

        {can.cancelPending ? (
          <ConfirmAction
            label={`Cancel order (${rooms})`}
            busyLabel="Cancelling…"
            pending={cancelPending.isPending}
            disabled={busy}
            tone="danger"
            question={`Cancel this pending order and free ${rooms}? No credit note is issued.`}
            confirmLabel="Yes, cancel it"
            onConfirm={() => cancelPending.mutate({ uid: orderUid })}
          />
        ) : null}

        {/* Nothing to sell and nothing to give back: the rooms went back on sale
            and may already belong to someone else. The refund happens in Stripe,
            by a person; this only records that it was dealt with, so the
            dashboard's red panel stops crying wolf for the rest of the event.
            The row keeps its payment id and its amount either way. */}
        {can.closeSettled ? (
          <ConfirmAction
            label={paid ? "Refunded in Stripe — close order" : "Close order"}
            busyLabel="Closing…"
            pending={closeOrder.isPending}
            disabled={busy}
            tone="quiet"
            question={
              paid
                ? "Close this order? Do this only once the payment has been refunded in Stripe and the buyer has been told. Nothing is refunded from here — the order is marked settled so it stops being flagged."
                : "Close this abandoned checkout? It holds no rooms and took no money."
            }
            confirmLabel="Yes, close it"
            onConfirm={() => closeOrder.mutate({ uid: orderUid })}
          />
        ) : null}

        {/* Paid, but the invoice never came out — the PDF render or the disk
            write failed and the webhook only logged it. Until this button
            existed the order was a dead end: it could not be invoiced, could not
            be credited (that needs an invoice number) and could not be cancelled
            (that path is PENDING-only), so its rooms stayed held until somebody
            edited the database by hand. issueInvoice is idempotent. */}
        {can.issueInvoice ? (
          <ConfirmAction
            label="Issue the missing invoice"
            busyLabel="Issuing…"
            pending={issueInvoice.isPending}
            disabled={busy}
            tone="primary"
            question={`Issue the missing invoice for ${rooms}? This spends the next invoice number and emails the booker. Safe to retry — it will not issue a second one.`}
            confirmLabel="Yes, issue it"
            onConfirm={() => issueInvoice.mutate({ uid: orderUid })}
          />
        ) : null}

        {can.resendInvoice ? (
          <ConfirmAction
            label="Resend invoice email"
            busyLabel="Sending…"
            pending={resend.isPending}
            disabled={busy}
            tone="quiet"
            question="Send the invoice to the booker again?"
            confirmLabel="Yes, send it"
            onConfirm={() => resend.mutate({ uid: orderUid })}
          />
        ) : null}

        {can.issueCreditNote ? (
          <ConfirmAction
            label="Cancel & credit"
            busyLabel="Cancelling…"
            pending={creditNote.isPending}
            disabled={busy}
            tone="danger"
            question={`Cancel the whole order? This cancels ${rooms}, frees the slots, issues a credit note and emails the booker. Refund the payment in Stripe separately.`}
            confirmLabel="Yes, cancel & credit"
            onConfirm={() => creditNote.mutate({ uid: orderUid })}
          />
        ) : null}

        {/* For a test booking, or one that never became anything. Kept away
            from the other buttons and worded so it cannot be misread: this
            removes the record, where every other action here preserves it. */}
        {can.deleteOrder ? <div className="my-1 h-px bg-gray-100" aria-hidden /> : null}
        {can.deleteOrder ? (
          <ConfirmAction
            label="Delete order"
            busyLabel="Deleting…"
            pending={deleteOrder.isPending}
            disabled={busy}
            tone="destructive"
            question={`Delete this order permanently? ${
              roomCount > 0
                ? `${roomCount === 1 ? "The room goes" : `The ${roomCount} rooms go`} back on sale. `
                : ""
            }Nothing is kept — use this for a test or a mistake, not for a booking that was invoiced.`}
            confirmLabel="Yes, delete it"
            onConfirm={() => deleteOrder.mutate({ uid: orderUid })}
          />
        ) : null}

        {hasNoActions(can) ? (
          <p className="text-gray-400 text-sm">
            {roomCount === 0 && status === "CONFIRMED"
              ? "This order is confirmed but holds no rooms and has no invoice. Nothing here can settle it — reconcile it in Stripe."
              : "No actions available for this order."}
          </p>
        ) : null}
      </div>

      {unavailable.length ? (
        <div className="mt-3 border-gray-100 border-t pt-3">
          <p className="text-gray-500 text-xs">Not available for this order</p>
          <ul className="mt-1.5 grid gap-1 text-gray-400 text-xs">
            {unavailable.map((u) => (
              <li key={u.label}>
                <span className="text-gray-500">{u.label}</span> — {u.reason}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

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

/**
 * One action, asked twice.
 *
 * These were browser dialogs. A dialog is not reliably shown — an embedded
 * browser swallows it, and any browser lets somebody switch dialogs off for the
 * rest of the session with the "don't let this page create more dialogs" box —
 * and when it is suppressed the button silently does nothing at all. For a
 * column of buttons that cancel orders, spend invoice numbers and delete
 * records, the question has to be part of the page.
 *
 * The second step is in the same place as the first, so the answer lands where
 * the eye already is, and the wording is the same sentence the dialog carried.
 */
function ConfirmAction({
  label,
  busyLabel,
  pending,
  disabled,
  question,
  confirmLabel,
  tone,
  onConfirm,
}: {
  label: string;
  busyLabel: string;
  pending: boolean;
  disabled: boolean;
  question: string;
  confirmLabel: string;
  tone: "primary" | "danger" | "destructive" | "quiet";
  onConfirm: () => void;
}): JSX.Element {
  const [asking, setAsking] = useState(false);

  const idle = {
    primary: `${btnBase} bg-[#000643] text-white hover:opacity-90`,
    danger: `${btnBase} border border-red-200 bg-white text-red-600 hover:border-red-400`,
    destructive: `${btnBase} border border-red-300 bg-red-50 text-red-700 hover:bg-red-100`,
    quiet: `${btnBase} border border-gray-300 bg-white text-gray-700 hover:border-gray-500`,
  }[tone];

  if (!asking) {
    return (
      <button type="button" disabled={disabled} onClick={() => setAsking(true)} className={idle}>
        {pending ? busyLabel : label}
      </button>
    );
  }

  const confirm =
    tone === "primary"
      ? `${btnBase} bg-[#000643] text-white hover:opacity-90`
      : `${btnBase} bg-red-600 text-white hover:bg-red-700`;

  return (
    <div className="rounded-lg border border-gray-200 bg-gray-50 p-3">
      <p className="text-[#000643] text-[13px] leading-snug">{question}</p>
      <div className="mt-2.5 grid grid-cols-2 gap-2">
        <button type="button" disabled={pending} onClick={onConfirm} className={confirm}>
          {pending ? busyLabel : confirmLabel}
        </button>
        <button
          type="button"
          disabled={pending}
          onClick={() => setAsking(false)}
          className={`${btnBase} border border-gray-200 bg-white text-[#000643] hover:border-[#000643]`}>
          Not now
        </button>
      </div>
    </div>
  );
}
