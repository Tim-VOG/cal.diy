"use client";

import { orderRef } from "@calcom/features/ne26-rooms/lib/orderRef";
import { ArrowRight, X } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import BookingActions from "./[uid]/BookingActions";
import { displayStatus, fmtCountdown, fmtDay, fmtMoment, fmtMoney, fmtTime } from "./format";
import type { AdminBookingRow } from "./RoomsAdminView";
import { StatusPill } from "./ui";

function Row({ label, children }: { label: string; children: ReactNode }): JSX.Element {
  return (
    <div className="flex justify-between gap-4 border-gray-100 border-b py-2 text-[13px] last:border-0">
      <dt className="text-gray-500">{label}</dt>
      <dd className="min-w-0 break-words text-right font-medium text-gray-900">{children}</dd>
    </div>
  );
}

/**
 * The selected booking, beside the plan rather than over it.
 *
 * It used to cover the page with a dark backdrop, which hid the very plan the
 * desk was reading. On a wide screen it now sits in its own column; on a narrow
 * one there is no room beside anything, so it still slides over.
 */
export default function BookingSidePanel({
  booking,
  onClose,
  now,
}: {
  booking: AdminBookingRow;
  onClose: () => void;
  now: Date | null;
}): JSX.Element {
  const status = displayStatus(booking);
  const msLeft =
    booking.status === "PENDING" && booking.holdExpiresAt && now
      ? new Date(booking.holdExpiresAt).getTime() - now.getTime()
      : null;

  return (
    <>
      <button
        type="button"
        aria-label="Close panel"
        onClick={onClose}
        className="fixed inset-0 z-40 cursor-default bg-black/30 xl:hidden"
      />
      <aside
        aria-label={`${booking.roomName} booking`}
        className="fixed inset-y-0 right-0 z-50 w-full max-w-sm overflow-y-auto bg-white p-5 shadow-xl xl:sticky xl:top-6 xl:z-auto xl:max-h-[calc(100vh-3rem)] xl:max-w-none xl:rounded-xl xl:border xl:border-gray-200 xl:p-4 xl:shadow-none">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="font-semibold text-[#000643] text-base">{booking.roomName}</h2>
              <StatusPill status={status} />
            </div>
            <p className="mt-0.5 text-gray-500 text-xs tabular-nums">
              {fmtDay(booking.startUtc)} · {fmtTime(booking.startUtc)}–{fmtTime(booking.endUtc)} ·{" "}
              {booking.durationMinutes / 60} h
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded-md p-1 text-gray-400 transition hover:bg-gray-100 hover:text-gray-700">
            <X className="h-4 w-4" aria-hidden />
          </button>
        </div>

        {msLeft !== null ? (
          <div className="mt-3 flex items-center justify-between rounded-lg border border-red-200 bg-red-50 px-3 py-2">
            <span className="text-red-700 text-xs">Hold ends in</span>
            <span className="font-bold text-red-600 text-xl tabular-nums">{fmtCountdown(msLeft)}</span>
          </div>
        ) : null}

        <dl className="mt-3">
          <Row label="Booker">{booking.bookerName}</Row>
          <Row label="Email">
            <a href={`mailto:${booking.bookerEmail}`} className="text-[#000643] hover:underline">
              {booking.bookerEmail}
            </a>
          </Row>
          <Row label="Ordered">{fmtMoment(booking.orderedAt)}</Row>
          <Row label="Paid">{booking.paidAt ? fmtMoment(booking.paidAt) : "—"}</Row>
          <Row label="Add-ons">
            {booking.addOns.length === 0
              ? "—"
              : booking.addOns.map((a) => `${a.name} × ${a.quantity}`).join(", ")}
          </Row>
          <Row label="Amount">{fmtMoney(booking.amountTotal, booking.currency)}</Row>
          {booking.orderNumber !== null ? (
            <Row label="Order">
              <span className="font-mono text-xs">{orderRef(booking.orderNumber)}</span>
              {booking.orderRoomCount > 1 ? (
                <span className="text-gray-500"> · {booking.orderRoomCount} rooms</span>
              ) : null}
            </Row>
          ) : null}
          <Row label="Invoice">
            {booking.invoiceNumber ? (
              <a
                href={`/rooms/invoice/${booking.documentUid}`}
                target="_blank"
                rel="noreferrer"
                className="text-[#000643] underline decoration-[#000643]/30 underline-offset-2">
                {booking.invoiceNumber}
              </a>
            ) : (
              "—"
            )}
          </Row>
          {booking.creditNoteNumber ? (
            <Row label="Credit note">
              <a
                href={`/rooms/credit-note/${booking.documentUid}`}
                target="_blank"
                rel="noreferrer"
                className="text-[#000643] underline decoration-[#000643]/30 underline-offset-2">
                {booking.creditNoteNumber}
              </a>
            </Row>
          ) : null}
        </dl>

        <div className="mt-3 border-gray-100 border-t pt-3">
          {booking.orderUid ? (
            <BookingActions
              orderUid={booking.orderUid}
              status={booking.status}
              hasInvoice={Boolean(booking.invoiceNumber)}
              hasCreditNote={Boolean(booking.creditNoteNumber)}
              roomCount={booking.orderRoomCount}
              paid={Boolean(booking.stripePaymentId)}
            />
          ) : (
            <p className="text-amber-800 text-sm">
              No order attached — this room predates the order model and has no payment to act on.
            </p>
          )}
        </div>

        <Link
          href={booking.orderUid ? `/rooms/admin/order/${booking.orderUid}` : `/rooms/admin/${booking.uid}`}
          className="mt-3 inline-flex items-center gap-1 font-medium text-[#000643] text-sm hover:underline">
          Open full detail <ArrowRight className="h-3.5 w-3.5" aria-hidden />
        </Link>
      </aside>
    </>
  );
}
