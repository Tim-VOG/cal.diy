import { getServerSession } from "@calcom/features/auth/lib/getServerSession";
import { getResourceBookingRepository } from "@calcom/features/ne26-rooms/di/ResourceBookingRepository.container";
import { buildLegacyRequest } from "@lib/buildLegacyCtx";
import type { Metadata } from "next";
import { cookies, headers } from "next/headers";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import type { ReactNode } from "react";

export const metadata: Metadata = {
  title: "Booking · NATO Edge 26 admin",
  robots: { index: false, follow: false },
};

const TZ = "Europe/Brussels";

function fmtDateTime(d: Date): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: TZ,
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(d);
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

function Card({ title, children }: { title: string; children: ReactNode }): JSX.Element {
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-5">
      <h2 className="font-semibold text-gray-500 text-xs uppercase tracking-wide">{title}</h2>
      <div className="mt-2">{children}</div>
    </div>
  );
}

export default async function AdminBookingDetailPage({
  params,
}: {
  params: Promise<{ uid: string }>;
}): Promise<JSX.Element> {
  const { uid } = await params;
  const session = await getServerSession({ req: buildLegacyRequest(await headers(), await cookies()) });
  if (!session?.user?.id) redirect(`/auth/login?callbackUrl=/rooms/admin/${uid}`);
  if (session.user.role !== "ADMIN") notFound();

  const booking = await getResourceBookingRepository().findByUidForAdmin(uid);
  if (!booking) notFound();

  return (
    <div className="mx-auto max-w-3xl">
      <Link href="/rooms/admin" className="text-gray-500 text-sm hover:text-[#000643]">
        ← Back to admin
      </Link>

      <div className="mt-2 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-bold text-2xl text-[#000643]">{booking.resource.name}</h1>
          <p className="mt-1 text-gray-500 text-sm">Reference {booking.uid}</p>
        </div>
        <span className={`rounded-full px-3 py-1 font-medium text-sm ${STATUS_BADGE[booking.status] ?? ""}`}>
          {booking.status}
        </span>
      </div>

      <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Card title="When (Europe/Brussels)">
          <Row label="Start">{fmtDateTime(booking.startTime)}</Row>
          <Row label="End">{fmtDateTime(booking.endTime)}</Row>
          <Row label="Duration">{booking.durationMinutes / 60}h</Row>
          <Row label="Room category">{booking.resource.category}</Row>
        </Card>

        <Card title="Booker">
          <Row label="Name">{booking.bookerName}</Row>
          <Row label="Email">{booking.bookerEmail}</Row>
          <Row label="Account ID">{booking.bookerUserId ?? "—"}</Row>
          <Row label="Country">{booking.bookerCountry || "—"}</Row>
          <Row label="VAT number">{booking.bookerVatNumber || "—"}</Row>
        </Card>

        <Card title="Payment">
          <Row label="Amount">{fmtMoney(booking.amountTotal, booking.currency)}</Row>
          <Row label="Stripe payment">{booking.stripePaymentId ?? "—"}</Row>
          {booking.status === "PENDING" ? (
            <Row label="Hold expires">{booking.holdExpiresAt ? fmtDateTime(booking.holdExpiresAt) : "—"}</Row>
          ) : null}
        </Card>

        <Card title="Documents">
          <Row label="Invoice">
            {booking.invoiceNumber ? (
              <a
                href={`/rooms/invoice/${booking.uid}`}
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
                href={`/rooms/credit-note/${booking.uid}`}
                target="_blank"
                rel="noreferrer"
                className="text-[#000643] underline hover:opacity-80">
                {booking.creditNoteNumber}
              </a>
            ) : (
              "—"
            )}
          </Row>
        </Card>
      </div>

      <div className="mt-4">
        <Card title="Add-ons">
          {booking.addOns.length === 0 ? (
            <p className="text-gray-400 text-sm">No add-ons</p>
          ) : (
            booking.addOns.map((a) => (
              <Row key={a.addOn.name} label={`${a.addOn.name} × ${a.quantity}`}>
                {fmtMoney(a.lineTotal, booking.currency)}
              </Row>
            ))
          )}
        </Card>
      </div>

      <p className="mt-4 text-gray-400 text-xs">
        Created {fmtDateTime(booking.createdAt)}
        {booking.updatedAt ? ` · Updated ${fmtDateTime(booking.updatedAt)}` : ""}
      </p>
    </div>
  );
}
