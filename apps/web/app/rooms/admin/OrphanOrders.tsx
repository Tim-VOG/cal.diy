import { EVENT_TIME_ZONE } from "@calcom/features/ne26-rooms/lib/eventSchedule";
import { AlertTriangle } from "lucide-react";
import Link from "next/link";

export interface OrphanOrderRow {
  uid: string;
  status: string;
  bookerName: string;
  bookerEmail: string;
  amountTotal: number;
  currency: string;
  stripePaymentId: string | null;
  invoiceNumber: string | null;
  holdExpiresAt: string | null;
  createdAt: string;
}

function fmt(iso: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: EVENT_TIME_ZONE,
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(iso));
}
function money(cents: number, currency: string): string {
  return new Intl.NumberFormat("en-GB", { style: "currency", currency }).format(cents / 100);
}

/**
 * Orders that hold no rooms.
 *
 * The dashboard below lists rooms, so an order whose rooms are gone does not
 * appear in it at all — and one of the ways rooms go is a payment that was
 * captured but never confirmed: the hold lapses and the rooms are reclaimed,
 * leaving the money invisible. That is precisely the case somebody has to look
 * at, so it is put first rather than left to be discovered.
 *
 * An order with a payment id is the urgent one: money moved. One without is
 * usually a checkout that was simply abandoned, and is listed quietly.
 */
export default function OrphanOrders({ rows }: { rows: OrphanOrderRow[] }): JSX.Element | null {
  if (rows.length === 0) return null;
  const paid = rows.filter((r) => r.stripePaymentId);
  const abandoned = rows.filter((r) => !r.stripePaymentId);

  return (
    <section className="mb-6" aria-label="Orders holding no rooms">
      {paid.length > 0 ? (
        <div className="rounded-lg border border-red-300 bg-red-50 px-4 py-3">
          <h2 className="flex items-center gap-2 font-semibold text-red-800 text-sm">
            <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden />
            {paid.length === 1
              ? "1 order was paid but holds no room"
              : `${paid.length} orders were paid but hold no room`}
          </h2>
          <p className="mt-1 text-red-700 text-xs">
            Money was captured and the rooms are gone — the confirmation never ran, or the hold lapsed first.
            Refund each of these in Stripe, then open it and close it so this panel clears.
          </p>
          <ul className="mt-2 divide-y divide-red-200">
            {paid.map((r) => (
              <li key={r.uid}>
                {/* The whole row opens the order. It used to be plain text,
                    because there was no order page to send anyone to — an alert
                    that named a problem and then refused to say more about it. */}
                <Link
                  href={`/rooms/admin/order/${r.uid}`}
                  className="-mx-2 flex flex-wrap items-baseline justify-between gap-x-4 rounded px-2 py-1.5 transition hover:bg-red-100">
                  <span className="font-medium text-red-900 text-sm">
                    {r.bookerName} <span className="font-normal text-red-700">{r.bookerEmail}</span>
                  </span>
                  <span className="text-red-800 text-sm tabular-nums">
                    {money(r.amountTotal, r.currency)} · {fmt(r.createdAt)}
                  </span>
                  <span className="font-mono text-red-900 text-xs">
                    {r.invoiceNumber ?? r.stripePaymentId}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {abandoned.length > 0 ? (
        <div className="mt-2 text-gray-400 text-xs">
          {abandoned.length === 1
            ? "1 abandoned checkout holds no room and took no money:"
            : `${abandoned.length} abandoned checkouts hold no rooms and took no money:`}{" "}
          {abandoned.map((r, i) => (
            <span key={r.uid}>
              {i > 0 ? ", " : ""}
              <Link href={`/rooms/admin/order/${r.uid}`} className="underline hover:text-gray-600">
                {r.bookerEmail || r.uid.slice(0, 8)}
              </Link>
            </span>
          ))}
        </div>
      ) : null}
    </section>
  );
}
