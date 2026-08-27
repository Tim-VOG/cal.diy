"use client";

import { X } from "lucide-react";
import type { ReactNode } from "react";
import BookingActions from "./[uid]/BookingActions";
import type { AdminBookingRow } from "./RoomsAdminView";

const TZ = "Europe/Istanbul";

function fmtDateTime(iso: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: TZ,
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(iso));
}
function fmtMoney(cents: number, currency: string): string {
  return new Intl.NumberFormat("en-GB", { style: "currency", currency }).format(cents / 100);
}

const STATUS_BADGE: Record<string, string> = {
  CONFIRMED: "bg-green-100 text-green-700",
  PENDING: "bg-amber-100 text-amber-700",
  CANCELLED: "bg-gray-100 text-gray-500",
};

function Row({ label, children }: { label: string; children: ReactNode }): JSX.Element {
  return (
    <div className="flex justify-between gap-4 border-gray-50 border-b py-2 text-sm last:border-0">
      <span className="text-gray-500">{label}</span>
      <span className="text-right font-medium text-gray-900">{children}</span>
    </div>
  );
}

export default function BookingSidePanel({
  booking,
  onClose,
}: {
  booking: AdminBookingRow;
  onClose: () => void;
}): JSX.Element {
  return (
    <>
      {/* Backdrop — overlays the page so the calendar keeps its full width. */}
      <button
        type="button"
        aria-label="Close panel"
        onClick={onClose}
        className="fixed inset-0 z-40 cursor-default bg-black/30"
      />
      <aside className="fixed top-0 right-0 z-50 h-full w-full max-w-sm overflow-y-auto border-gray-200 border-l bg-white p-5 shadow-xl">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="font-bold text-[#000643] text-lg">{booking.roomName}</h2>
            <span
              className={`mt-1 inline-block rounded-full px-2 py-0.5 font-medium text-xs ${STATUS_BADGE[booking.status] ?? ""}`}>
              {booking.status}
            </span>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded-md p-1 text-gray-400 transition hover:bg-gray-100 hover:text-gray-700">
            <X className="h-5 w-5" aria-hidden />
          </button>
        </div>

        <div className="mt-4">
          <Row label="When">
            {fmtDateTime(booking.startUtc)} – {fmtDateTime(booking.endUtc)}
          </Row>
          <Row label="Duration">{booking.durationMinutes / 60}h</Row>
          <Row label="Booker">{booking.bookerName}</Row>
          <Row label="Email">{booking.bookerEmail}</Row>
          <Row label="Amount">{fmtMoney(booking.amountTotal, booking.currency)}</Row>
          <Row label="Payment">{booking.stripePaymentId ?? "—"}</Row>
          <Row label="Add-ons">
            {booking.addOns.length === 0
              ? "—"
              : booking.addOns.map((a) => `${a.name}×${a.quantity}`).join(", ")}
          </Row>
          <Row label="Invoice">
            {booking.invoiceNumber ? (
              <a
                href={`/rooms/invoice/${booking.orderUid ?? booking.uid}`}
                target="_blank"
                rel="noreferrer"
                className="text-[#000643] underline hover:opacity-80">
                {booking.invoiceNumber}
              </a>
            ) : (
              "—"
            )}
          </Row>
          <Row label="Credit note">
            {booking.creditNoteNumber ? (
              <a
                href={`/rooms/credit-note/${booking.orderUid ?? booking.uid}`}
                target="_blank"
                rel="noreferrer"
                className="text-[#000643] underline hover:opacity-80">
                {booking.creditNoteNumber}
              </a>
            ) : (
              "—"
            )}
          </Row>
        </div>

        <div className="mt-4 border-gray-100 border-t pt-4">
          {booking.orderUid ? (
            <BookingActions
              orderUid={booking.orderUid}
              status={booking.status}
              hasInvoice={Boolean(booking.invoiceNumber)}
              hasCreditNote={Boolean(booking.creditNoteNumber)}
              roomCount={booking.orderRoomCount}
            />
          ) : (
            <p className="text-amber-700 text-sm">
              No order attached — this room predates the order model and has no payment to act on.
            </p>
          )}
        </div>

        <a
          href={`/rooms/admin/${booking.uid}`}
          className="mt-3 inline-block text-[#000643] text-sm hover:underline">
          Open full detail →
        </a>
      </aside>
    </>
  );
}
