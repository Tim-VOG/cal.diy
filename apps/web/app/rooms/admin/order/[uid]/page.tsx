import { getServerSession } from "@calcom/features/auth/lib/getServerSession";
import { getNe26OrderRepository } from "@calcom/features/ne26-rooms/di/Ne26OrderRepository.container";
import { getNe26RoomSettingsRepository } from "@calcom/features/ne26-rooms/di/Ne26RoomSettingsRepository.container";
import { buildEventSchedule, SLOT_GRANULARITY_MS } from "@calcom/features/ne26-rooms/lib/eventSchedule";
import { availableOrderActions } from "@calcom/features/ne26-rooms/lib/orderActions";
import { orderRef } from "@calcom/features/ne26-rooms/lib/orderRef";
import { buildLegacyRequest } from "@lib/buildLegacyCtx";
import { AlertTriangle, FileText, OctagonAlert, ReceiptText } from "lucide-react";
import type { Metadata } from "next";
import { cookies, headers } from "next/headers";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import type { ReactNode } from "react";
import BookingActions from "../../[uid]/BookingActions";
import { displayStatus, fmtDay, fmtMoment, fmtMoney, fmtTime } from "../../format";
import { requireNotDeskMode } from "../../requireNotDeskMode";
import { HATCH, StatusPill } from "../../ui";
import HoldCountdownText from "./HoldCountdownText";

export const metadata: Metadata = {
  title: "Order · NATO Edge 26 admin",
  robots: { index: false, follow: false },
};

function Section({
  title,
  children,
  className = "",
}: {
  title: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`rounded-xl border border-gray-200 bg-white p-4 ${className}`}>
      <h2 className="font-semibold text-[11px] text-gray-500 uppercase tracking-[0.07em]">{title}</h2>
      <div className="mt-2">{children}</div>
    </section>
  );
}

function Pair({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex justify-between gap-4 border-gray-100 border-b py-1.5 text-[13px] last:border-0">
      <dt className="text-gray-500">{label}</dt>
      <dd className="min-w-0 break-words text-right font-medium text-gray-900">{children}</dd>
    </div>
  );
}

/**
 * One order: what it holds, where on the three days, what was issued, and what
 * to do next.
 *
 * Reached from the plan, the list, and "Needs attention" — which is the only way
 * in for an order whose rooms are gone, the case someone most needs to open.
 * The next step is said at the top in the desk's words, because every one of
 * these orders arrives here with a question, and the answer used to be a row of
 * buttons with no indication which one it was.
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

  const [order, roomSettings] = await Promise.all([
    getNe26OrderRepository().findForAdmin(uid),
    getNe26RoomSettingsRepository().get(),
  ]);
  if (!order) notFound();

  const rooms = order.bookings;
  const paid = Boolean(order.stripePaymentId);
  const shown = displayStatus(order);
  const state = {
    status: order.status,
    hasInvoice: Boolean(order.invoiceNumber),
    hasCreditNote: Boolean(order.creditNoteNumber),
    // Rooms still holding their slot. A credited order keeps its booking rows,
    // CANCELLED, so they are listed — but they hold nothing.
    roomCount: rooms.filter((b) => b.status !== "CANCELLED").length,
    paid,
  };
  const can = availableOrderActions(state);
  const billTo = [
    order.bookerLegalName,
    order.bookerAddressLine1,
    order.bookerAddressLine2,
    [order.bookerPostalCode, order.bookerCity].filter(Boolean).join(" "),
    order.bookerCountry,
  ].filter(Boolean);

  // The one thing to do, if there is one. Ordered like the dashboard's list.
  type Next = { tone: "critical" | "warning" | "info"; title: string; body: ReactNode };
  let next: Next | null = null;
  if (state.roomCount === 0 && rooms.length === 0 && paid && order.status === "PENDING") {
    next = {
      tone: "critical",
      title: "Refund in Stripe, then close the order",
      body: "Money was captured and the rooms are gone — the confirmation never ran, or the hold lapsed first. They may already belong to someone else and cannot be given back or invoiced from here.",
    };
  } else if (can.issueInvoice) {
    next = {
      tone: "warning",
      title: "Issue the missing invoice",
      body: `Stripe captured ${fmtMoney(order.amountTotal, order.currency)}${
        order.paidAt ? ` on ${fmtMoment(order.paidAt.toISOString())}` : ""
      }, but no invoice was produced. Issuing uses the next number in the series and emails the booker. Safe to retry — it never issues a second one.`,
    };
  } else if (order.status === "PENDING" && state.roomCount > 0 && order.holdExpiresAt) {
    next = {
      tone: "info",
      title: "Waiting for payment",
      body: (
        <>
          The rooms are held for the buyer until{" "}
          <HoldCountdownText expiresAt={order.holdExpiresAt.toISOString()} />. If they pay by bank transfer
          instead, mark the order as paid once the money has arrived.
        </>
      ),
    };
  } else if (rooms.length === 0 && !paid && order.status === "PENDING") {
    next = {
      tone: "info",
      title: "Abandoned checkout",
      body: "This order holds no rooms and took no money. Close it to clear it from the dashboard.",
    };
  }

  const NEXT_STYLE = {
    critical: { box: "border-red-200 bg-red-50", icon: "bg-red-100 text-red-700", Icon: OctagonAlert },
    warning: {
      box: "border-amber-200 bg-amber-50",
      icon: "bg-amber-100 text-amber-700",
      Icon: AlertTriangle,
    },
    info: { box: "border-gray-200 bg-white", icon: "bg-indigo-50 text-indigo-600", Icon: ReceiptText },
  } as const;

  const schedule = buildEventSchedule(roomSettings.eventDays);

  return (
    <div className="grid gap-5">
      <nav aria-label="Breadcrumb" className="text-gray-500 text-xs">
        <Link href="/rooms/admin" className="hover:text-[#000643]">
          Bookings
        </Link>{" "}
        <span className="text-gray-300">›</span> Order {orderRef(order.orderNumber)}
      </nav>

      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="font-bold text-2xl text-[#000643] tracking-tight">
              Order {orderRef(order.orderNumber)}
            </h1>
            <StatusPill status={shown} />
            {can.issueInvoice ? (
              <span className="rounded bg-amber-50 px-1.5 py-0.5 font-semibold text-[11px] text-amber-800 ring-1 ring-amber-600/20 ring-inset">
                Invoice missing
              </span>
            ) : null}
          </div>
          <p className="mt-1 text-gray-500 text-sm">
            {order.bookerName} · {rooms.length} {rooms.length === 1 ? "room" : "rooms"} · placed{" "}
            {fmtMoment(order.createdAt.toISOString())}
            {order.paidAt ? ` · paid ${fmtMoment(order.paidAt.toISOString())}` : ""}
          </p>
        </div>
        <div className="text-right">
          <p className="font-bold text-2xl text-[#000643] tabular-nums tracking-tight">
            {fmtMoney(order.amountTotal, order.currency)}
          </p>
          <p className="text-gray-500 text-xs">
            {order.creditNoteNumber ? "credited in full, " : ""}excl. VAT{paid ? " · paid by card" : ""}
          </p>
        </div>
      </header>

      {next ? (
        <section
          className={`flex gap-3 rounded-xl border p-4 ${NEXT_STYLE[next.tone].box}`}
          aria-label="Next step">
          <span
            className={`grid h-9 w-9 shrink-0 place-items-center rounded-full ${NEXT_STYLE[next.tone].icon}`}>
            {(() => {
              const Icon = NEXT_STYLE[next.tone].Icon;
              return <Icon className="h-4 w-4" aria-hidden />;
            })()}
          </span>
          <div>
            <p className="font-semibold text-[11px] text-gray-500 uppercase tracking-[0.07em]">Next step</p>
            <p className="mt-0.5 font-semibold text-[#000643] text-base">{next.title}</p>
            <p className="mt-1 max-w-[70ch] text-gray-700 text-sm">{next.body}</p>
          </div>
        </section>
      ) : null}

      <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="grid min-w-0 gap-5">
          <Section title="On the plan — what this order holds across the three days">
            <div className="grid gap-2">
              {schedule.map((day) => {
                const open = day.openSlotStartsUtc[0]?.getTime() ?? 0;
                const close =
                  (day.openSlotStartsUtc[day.openSlotStartsUtc.length - 1]?.getTime() ?? open) +
                  SLOT_GRANULARITY_MS;
                const span = Math.max(1, close - open);
                const hours = Math.round(span / 3_600_000);
                const onDay = rooms.filter(
                  (b) => b.endTime.getTime() > open && b.startTime.getTime() < close
                );
                return (
                  <div key={day.date} className="grid grid-cols-[5.5rem_minmax(0,1fr)] items-center gap-3">
                    <span className="text-gray-600 text-xs">{fmtDay(new Date(open).toISOString())}</span>
                    <div
                      className="relative h-9 rounded-md border border-gray-100 bg-gray-50"
                      style={{
                        backgroundImage: "linear-gradient(to right, #e8eaf0 1px, transparent 1px)",
                        backgroundSize: `calc(100% / ${hours}) 100%`,
                      }}>
                      {onDay.map((b) => {
                        const left = ((Math.max(b.startTime.getTime(), open) - open) / span) * 100;
                        const width =
                          ((Math.min(b.endTime.getTime(), close) - Math.max(b.startTime.getTime(), open)) /
                            span) *
                          100;
                        const freed = b.status === "CANCELLED";
                        const held = b.status === "PENDING";
                        return (
                          <span
                            key={b.uid}
                            className={`absolute top-1 bottom-1 overflow-hidden rounded px-1.5 text-[11px] leading-[26px] ${
                              freed ? "text-gray-500" : held ? "text-amber-950" : "text-[#000643]"
                            }`}
                            style={{
                              left: `${left}%`,
                              width: `calc(${width}% - 2px)`,
                              background: freed ? HATCH.blocked : held ? HATCH.held : "#e9ebf7",
                              border: `1px solid ${freed ? "#d1d5db" : held ? "#f5c46b" : "#c9cde8"}`,
                            }}
                            title={`${b.resource.name} · ${fmtTime(b.startTime.toISOString())}–${fmtTime(b.endTime.toISOString())}`}>
                            <span className="truncate font-semibold">{b.resource.name}</span>
                            {freed ? " · freed" : ` · ${fmtTime(b.startTime.toISOString())}`}
                          </span>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
            {rooms.some((b) => b.status === "CANCELLED") ? (
              <p className="mt-2 text-gray-500 text-xs">
                Freed rooms went back on sale when the order was cancelled or credited.
              </p>
            ) : null}
          </Section>

          <Section title={`Rooms (${rooms.length})`}>
            {rooms.length === 0 ? (
              <p className="text-gray-500 text-sm">None — see the next step above.</p>
            ) : (
              <div className="-mx-4 overflow-x-auto">
                <table className="w-full min-w-[36rem] text-left text-[13px]">
                  <thead>
                    <tr className="border-gray-100 border-b text-[10.5px] text-gray-500 uppercase tracking-[0.05em]">
                      <th className="px-4 py-2 font-semibold">Room</th>
                      <th className="px-4 py-2 font-semibold">When (TRT)</th>
                      <th className="px-4 py-2 font-semibold">Add-ons</th>
                      <th className="px-4 py-2 text-right font-semibold">Amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rooms.map((b) => (
                      <tr key={b.uid} className="border-gray-100 border-b align-top last:border-0">
                        <td className="px-4 py-2.5">
                          <span className="font-semibold text-[#000643]">{b.resource.name}</span>
                          <div className="text-[10.5px] text-gray-400 uppercase tracking-wide">
                            {b.resource.category} · {b.resource.capacity} people
                          </div>
                        </td>
                        <td className="px-4 py-2.5 tabular-nums">
                          {fmtDay(b.startTime.toISOString())} ·{" "}
                          <span className="font-semibold">
                            {fmtTime(b.startTime.toISOString())}–{fmtTime(b.endTime.toISOString())}
                          </span>
                          <div className="text-gray-400 text-xs">{b.durationMinutes / 60} h</div>
                        </td>
                        <td className="px-4 py-2.5 text-gray-600 text-xs">
                          {b.addOns.length
                            ? b.addOns
                                .map(
                                  (a) =>
                                    `${a.addOn.name} × ${a.quantity} · ${fmtMoney(a.lineTotal, b.currency)}`
                                )
                                .join(", ")
                            : "—"}
                        </td>
                        <td className="px-4 py-2.5 text-right font-semibold tabular-nums">
                          {fmtMoney(b.amountTotal, b.currency)}
                        </td>
                      </tr>
                    ))}
                    <tr>
                      <td colSpan={3} className="px-4 pt-2.5 text-right text-gray-500 text-xs">
                        Order total (excl. VAT)
                      </td>
                      <td className="px-4 pt-2.5 text-right font-bold text-[#000643] tabular-nums">
                        {fmtMoney(order.amountTotal, order.currency)}
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            )}
          </Section>

          <div className="grid gap-5 md:grid-cols-2">
            <Section title="Booker">
              <dl>
                <Pair label="Name">{order.bookerName}</Pair>
                <Pair label="Email">
                  <a href={`mailto:${order.bookerEmail}`} className="text-[#000643] hover:underline">
                    {order.bookerEmail}
                  </a>
                </Pair>
                <Pair label="Account ID">{order.bookerUserId ?? "—"}</Pair>
                <Pair label="Country">{order.bookerCountry || "—"}</Pair>
                <Pair label="VAT number">{order.bookerVatNumber || "—"}</Pair>
                {order.bookerPoNumber ? <Pair label="PO number">{order.bookerPoNumber}</Pair> : null}
                {order.bookerInternalReference ? (
                  <Pair label="Internal reference">{order.bookerInternalReference}</Pair>
                ) : null}
              </dl>
            </Section>
            <Section title="Bill to">
              {billTo.length === 0 ? (
                <p className="text-gray-400 text-sm">Nothing was collected at checkout.</p>
              ) : (
                <p className="whitespace-pre-line text-gray-900 text-sm leading-relaxed">
                  {billTo.join("\n")}
                </p>
              )}
            </Section>
          </div>
        </div>

        <div className="grid gap-5 xl:sticky xl:top-6">
          <Section title="Documents">
            <ul className="grid gap-2">
              <li className="flex items-center justify-between gap-3 text-sm">
                <span className="flex min-w-0 items-center gap-2">
                  <FileText className="h-4 w-4 shrink-0 text-gray-400" aria-hidden />
                  {order.invoiceNumber ? (
                    <a
                      href={`/rooms/invoice/${order.uid}`}
                      target="_blank"
                      rel="noreferrer"
                      className="truncate text-[#000643] underline decoration-[#000643]/30 underline-offset-2">
                      {order.invoiceNumber}
                    </a>
                  ) : (
                    <span className="text-gray-400">Invoice — not issued</span>
                  )}
                </span>
                {order.invoiceNumber ? (
                  <span className="shrink-0 text-gray-500 text-xs tabular-nums">
                    {fmtMoney(order.amountTotal, order.currency)}
                  </span>
                ) : null}
              </li>
              <li className="flex items-center justify-between gap-3 text-sm">
                <span className="flex min-w-0 items-center gap-2">
                  <FileText className="h-4 w-4 shrink-0 text-gray-400" aria-hidden />
                  {order.creditNoteNumber ? (
                    <a
                      href={`/rooms/credit-note/${order.uid}`}
                      target="_blank"
                      rel="noreferrer"
                      className="truncate text-[#000643] underline decoration-[#000643]/30 underline-offset-2">
                      {order.creditNoteNumber}
                    </a>
                  ) : (
                    <span className="text-gray-400">Credit note — none issued</span>
                  )}
                </span>
                {order.creditNoteNumber ? (
                  <span className="shrink-0 text-gray-500 text-xs tabular-nums">
                    −{fmtMoney(order.amountTotal, order.currency)}
                  </span>
                ) : null}
              </li>
            </ul>
          </Section>

          <Section title="Payment">
            <dl>
              {/* The payment id is what reconciles this against Stripe, so it is
                  shown whole and selectable rather than truncated to fit. */}
              <Pair label="Stripe payment">
                <span className="break-all font-mono text-xs">{order.stripePaymentId ?? "—"}</span>
              </Pair>
              <Pair label="Placed">{fmtMoment(order.createdAt.toISOString())}</Pair>
              <Pair label="Paid">{order.paidAt ? fmtMoment(order.paidAt.toISOString()) : "—"}</Pair>
              {order.status === "PENDING" && order.holdExpiresAt ? (
                <Pair label="Hold">
                  <HoldCountdownText expiresAt={order.holdExpiresAt.toISOString()} />
                </Pair>
              ) : null}
            </dl>
          </Section>

          <BookingActions
            orderUid={order.uid}
            status={order.status}
            hasInvoice={state.hasInvoice}
            hasCreditNote={state.hasCreditNote}
            roomCount={state.roomCount}
            paid={paid}
            variant="rail"
          />
        </div>
      </div>

      <p className="text-gray-400 text-xs">
        Order {order.uid} · created {fmtMoment(order.createdAt.toISOString())} · updated{" "}
        {fmtMoment(order.updatedAt.toISOString())}
      </p>
    </div>
  );
}
