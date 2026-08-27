"use client";

import { trpc } from "@calcom/trpc/react";
import { useRouter } from "next/navigation";

const btnBase = "rounded-lg px-4 py-2 font-semibold text-sm transition disabled:opacity-40";

/**
 * Every action here addresses the ORDER, never the room: one payment can cover
 * several rooms and issues one invoice, so confirming, cancelling or crediting
 * half of it would leave the rest stranded. `roomCount` is what the
 * confirmations say out loud, so an admin crediting from one room's page knows
 * how many rooms go with it.
 */
export default function BookingActions({
  orderUid,
  status,
  hasInvoice,
  hasCreditNote,
  roomCount,
}: {
  orderUid: string;
  status: string;
  hasInvoice: boolean;
  hasCreditNote: boolean;
  roomCount: number;
}): JSX.Element {
  const router = useRouter();
  const refresh = { onSuccess: () => router.refresh() };
  const confirmManually = trpc.viewer.rooms.confirmBookingManually.useMutation(refresh);
  const cancelPending = trpc.viewer.rooms.cancelPendingBooking.useMutation(refresh);
  const creditNote = trpc.viewer.rooms.issueCreditNote.useMutation(refresh);
  const resend = trpc.viewer.rooms.resendInvoice.useMutation();
  const busy =
    confirmManually.isPending || cancelPending.isPending || creditNote.isPending || resend.isPending;

  const error = confirmManually.error ?? cancelPending.error ?? creditNote.error ?? resend.error;
  const rooms = roomCount > 1 ? `these ${roomCount} rooms` : "this room";

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-5">
      <h2 className="font-semibold text-gray-500 text-xs uppercase tracking-wide">Actions</h2>
      <div className="mt-3 flex flex-wrap gap-2">
        {status === "PENDING" ? (
          <>
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                if (
                  window.confirm(
                    `Confirm the order for ${rooms} as paid (e.g. bank transfer)? One invoice will be issued for the whole order.`
                  )
                ) {
                  confirmManually.mutate({ uid: orderUid });
                }
              }}
              className={`${btnBase} bg-[#000643] text-white hover:opacity-90`}>
              {confirmManually.isPending ? "Confirming…" : "Confirm (paid offline)"}
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                if (
                  window.confirm(`Cancel this pending order and free ${rooms}? No credit note is issued.`)
                ) {
                  cancelPending.mutate({ uid: orderUid });
                }
              }}
              className={`${btnBase} border border-red-200 text-red-600 hover:border-red-400`}>
              {cancelPending.isPending ? "Cancelling…" : `Cancel order (${rooms})`}
            </button>
          </>
        ) : null}

        {hasInvoice ? (
          <button
            type="button"
            disabled={busy}
            onClick={() => resend.mutate({ uid: orderUid })}
            className={`${btnBase} border border-gray-200 text-[#000643] hover:border-[#000643]`}>
            {resend.isPending ? "Sending…" : "Resend invoice email"}
          </button>
        ) : null}

        {status === "CONFIRMED" && hasInvoice && !hasCreditNote ? (
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

        {status !== "PENDING" && !hasInvoice ? (
          <p className="text-gray-400 text-sm">No actions available for this order.</p>
        ) : null}
      </div>

      {resend.isSuccess ? (
        <p className="mt-2 text-green-600 text-sm">
          {resend.data?.sent ? "Invoice email sent ✓" : "No invoice to send."}
        </p>
      ) : null}
      {error ? <p className="mt-2 text-red-600 text-sm">{error.message}</p> : null}
    </div>
  );
}
