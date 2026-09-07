import { getServerSession } from "@calcom/features/auth/lib/getServerSession";
import { getNe26OrderRepository } from "@calcom/features/ne26-rooms/di/Ne26OrderRepository.container";
import { EVENT_TIME_ZONE } from "@calcom/features/ne26-rooms/lib/eventSchedule";
import { buildLegacyRequest } from "@lib/buildLegacyCtx";
import type { Metadata } from "next";
import { cookies, headers } from "next/headers";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import type { ReactNode } from "react";
import BookingActions from "../../[uid]/BookingActions";
import { requireNotDeskMode } from "../../requireNotDeskMode";

export const metadata: Metadata = {
  title: "Order · NATO Edge 26 admin",
  robots: { index: false, follow: false },
};

function fmtDateTime(d: Date): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: EVENT_TIME_ZONE,
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

/**
 * One order, opened directly rather than through one of its rooms.
 *
 * The room detail page is reached from a list of rooms, which is precisely the
 * path that does not exist for an order whose rooms are gone — the case someone
 * most needs to open. The dashboard announced those orders in red and then had
 * nowhere to send anyone: the panel said "reconcile or refund this in Stripe"
 * next to a payment id, and that was the end of what the app would tell you.
 * Everything needed to make that decision — who bought, what they were charged,
 * whether an invoice ever went out — lives on this page.
 */
export default async function AdminOrderPage({
  params,
}: {
  params: Promise<{ uid: string }>;
}): Promise<JSX.Element> {
  const { uid } = await params;
  const session = await getServerSession({ req: buildLegacyRequest(await headers(), await cookies()) });
  if (!session?.user?.id) redirect(`/rooms/login?callbackUrl=/rooms/admin/order/${uid}`);
  if (session.user.role !== "ADMIN") notFound();
  await requireNotDeskMode();

  const order = await getNe26OrderRepository().findForAdmin(uid);
  if (!order) notFound();

  const rooms = order.bookings;
  const paid = Boolean(order.stripePaymentId);
  const billTo = [
    order.bookerLegalName,
    order.bookerAddressLine1,
    order.bookerAddressLine2,
    [order.bookerPostalCode, order.bookerCity].filter(Boolean).join(" "),
    order.bookerCountry,
  ].filter(Boolean);

  return (
    <div className="mx-auto max-w-3xl">
      <Link href="/rooms/admin" className="text-gray-500 text-sm hover:text-[#000643]">
        ← Back to admin
      </Link>

      <div className="mt-2 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-bold text-2xl text-[#000643]">Order</h1>
          <p className="mt-1 font-mono text-gray-500 text-sm">{order.uid}</p>
        </div>
        <span className={`rounded-full px-3 py-1 font-medium text-sm ${STATUS_BADGE[order.status] ?? ""}`}>
          {order.status}
        </span>
      </div>

      {/* Said once, at the top, in the words the person reading it needs. An
          order holding no rooms is either a disaster or a non-event, and which
          one it is depends entirely on whether money moved. */}
      {rooms.length === 0 ? (
        <div
          className={`mt-4 rounded-xl border p-4 text-sm ${
            paid ? "border-red-300 bg-red-50 text-red-800" : "border-gray-200 bg-gray-50 text-gray-600"
          }`}>
          {paid ? (
            <>
              <strong>This order was paid and holds no rooms.</strong> The confirmation never ran, or the hold
              lapsed before the payment landed — the rooms went back on sale and may already belong to someone
              else. They cannot be given back from here, and nothing may be invoiced for them. Refund the
              payment in Stripe, tell the buyer, then close the order below.
            </>
          ) : (
            <>
              <strong>This order holds no rooms and took no money.</strong> An abandoned checkout. Closing it
              clears it from the dashboard.
            </>
          )}
        </div>
      ) : null}

      <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Card title="Booker">
          <Row label="Name">{order.bookerName}</Row>
          <Row label="Email">
            <a href={`mailto:${order.bookerEmail}`} className="text-[#000643] underline hover:opacity-80">
              {order.bookerEmail}
            </a>
          </Row>
          <Row label="Account ID">{order.bookerUserId ?? "—"}</Row>
          <Row label="Country">{order.bookerCountry || "—"}</Row>
          <Row label="VAT number">{order.bookerVatNumber || "—"}</Row>
        </Card>

        <Card title="Payment">
          <Row label="Order total (excl. VAT)">{fmtMoney(order.amountTotal, order.currency)}</Row>
          {/* The payment id is what reconciles this against Stripe, so it is
              shown whole and selectable rather than truncated to fit. */}
          <Row label="Stripe payment">
            <span className="break-all font-mono text-xs">{order.stripePaymentId ?? "—"}</span>
          </Row>
          <Row label="Placed">{fmtDateTime(order.createdAt)}</Row>
          <Row label="Paid">{order.paidAt ? fmtDateTime(order.paidAt) : "—"}</Row>
          {order.status === "PENDING" ? (
            <Row label="Hold expires">{order.holdExpiresAt ? fmtDateTime(order.holdExpiresAt) : "—"}</Row>
          ) : null}
        </Card>

        <Card title="Documents">
          <Row label="Invoice">
            {order.invoiceNumber ? (
              <a
                href={`/rooms/invoice/${order.uid}`}
                target="_blank"
                rel="noreferrer"
                className="text-[#000643] underline hover:opacity-80">
                {order.invoiceNumber}
              </a>
            ) : (
              "—"
            )}
          </Row>
          <Row label="Credit note">
            {order.creditNoteNumber ? (
              <a
                href={`/rooms/credit-note/${order.uid}`}
                target="_blank"
                rel="noreferrer"
                className="text-[#000643] underline hover:opacity-80">
                {order.creditNoteNumber}
              </a>
            ) : (
              "—"
            )}
          </Row>
        </Card>

        <Card title="Bill to">
          {billTo.length === 0 ? (
            <p className="text-gray-400 text-sm">Nothing was collected at checkout.</p>
          ) : (
            <p className="whitespace-pre-line text-gray-900 text-sm">{billTo.join("\n")}</p>
          )}
        </Card>
      </div>

      <div className="mt-4">
        <Card title={`Rooms (${rooms.length})`}>
          {rooms.length === 0 ? (
            <p className="text-gray-400 text-sm">None. See above.</p>
          ) : (
            rooms.map((b) => (
              <Row key={b.uid} label={b.resource.name}>
                <Link href={`/rooms/admin/${b.uid}`} className="text-[#000643] underline hover:opacity-80">
                  {fmtDateTime(b.startTime)}
                </Link>
              </Row>
            ))
          )}
        </Card>
      </div>

      <div className="mt-4">
        <BookingActions
          orderUid={order.uid}
          status={order.status}
          hasInvoice={Boolean(order.invoiceNumber)}
          hasCreditNote={Boolean(order.creditNoteNumber)}
          roomCount={rooms.length}
          paid={paid}
        />
      </div>

      <p className="mt-4 text-gray-400 text-xs">
        Created {fmtDateTime(order.createdAt)} · Updated {fmtDateTime(order.updatedAt)}
      </p>
    </div>
  );
}
