"use client";

import { trpc } from "@calcom/trpc/react";
import { useRouter } from "next/navigation";

const btnBase = "rounded-lg px-4 py-2 font-semibold text-sm transition disabled:opacity-40";

export default function BookingActions({
  uid,
  status,
  hasInvoice,
}: {
  uid: string;
  status: string;
  hasInvoice: boolean;
}): JSX.Element {
  const router = useRouter();
  const refresh = { onSuccess: () => router.refresh() };
  const confirmManually = trpc.viewer.rooms.confirmBookingManually.useMutation(refresh);
  const cancelPending = trpc.viewer.rooms.cancelPendingBooking.useMutation(refresh);
  const resend = trpc.viewer.rooms.resendInvoice.useMutation();
  const busy = confirmManually.isPending || cancelPending.isPending || resend.isPending;

  const error = confirmManually.error ?? cancelPending.error ?? resend.error;

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
                    "Confirm this booking as paid (e.g. bank transfer)? An invoice will be issued."
                  )
                ) {
                  confirmManually.mutate({ uid });
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
                  window.confirm("Cancel this pending booking and free the slot? No credit note is issued.")
                ) {
                  cancelPending.mutate({ uid });
                }
              }}
              className={`${btnBase} border border-red-200 text-red-600 hover:border-red-400`}>
              {cancelPending.isPending ? "Cancelling…" : "Cancel booking"}
            </button>
          </>
        ) : null}

        {hasInvoice ? (
          <button
            type="button"
            disabled={busy}
            onClick={() => resend.mutate({ uid })}
            className={`${btnBase} border border-gray-200 text-[#000643] hover:border-[#000643]`}>
            {resend.isPending ? "Sending…" : "Resend invoice email"}
          </button>
        ) : null}

        {status !== "PENDING" && !hasInvoice ? (
          <p className="text-gray-400 text-sm">No actions available for this booking.</p>
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
