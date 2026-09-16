import { getServerSession } from "@calcom/features/auth/lib/getServerSession";
import { getNe26RoomSettingsRepository } from "@calcom/features/ne26-rooms/di/Ne26RoomSettingsRepository.container";
import { getResourceBookingRepository } from "@calcom/features/ne26-rooms/di/ResourceBookingRepository.container";
import { buildEventSchedule, SLOT_GRANULARITY_MS } from "@calcom/features/ne26-rooms/lib/eventSchedule";
import { buildLegacyRequest } from "@lib/buildLegacyCtx";
import { CalendarPlus, Clock3, FileText } from "lucide-react";
import type { Metadata } from "next";
import { cookies, headers } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";
import { displayStatus, fmtDay, fmtDayLong, fmtMoney, fmtTime } from "../admin/format";
import { HATCH, StatusPill } from "../admin/ui";
import { requireBillingProfile } from "../requireBillingProfile";
import HoldCountdown from "./HoldCountdown";
import ResumePaymentButton from "./ResumePaymentButton";

export const metadata: Metadata = {
  title: "My bookings · NATO Edge 26",
  robots: { index: false, follow: false },
};

const HOUR = 3_600_000;

/**
 * An exhibitor's rooms, laid out the way the event is: three days, one room a
 * day, each meeting in its place in the day.
 *
 * It was a flat list, one line per room, the same invoice repeated, and nothing
 * to say which day was still free or where to get the calendar file once the
 * confirmation email was gone.
 */
export default async function MyBookingsPage(): Promise<JSX.Element> {
  const session = await getServerSession({ req: buildLegacyRequest(await headers(), await cookies()) });
  if (!session?.user?.id) redirect("/rooms/login?callbackUrl=/rooms/bookings");
  await requireBillingProfile(session, "/rooms/bookings");

  // Clear abandoned, unpaid bookings whose hold has expired so they don't linger.
  const bookingRepo = getResourceBookingRepository();
  await bookingRepo.deleteExpiredHolds(new Date());
  const [all, roomSettings] = await Promise.all([
    bookingRepo.findByBookerUserIdWithDetails(session.user.id),
    getNe26RoomSettingsRepository().get(),
  ]);

  const rows = all.map((b) => ({
    ...b,
    shown: displayStatus({ status: b.status, creditNoteNumber: b.order?.creditNoteNumber ?? null }),
    documentUid: b.order?.uid ?? b.uid,
  }));
  const live = rows.filter((b) => b.status !== "CANCELLED");

  // Holds, one banner per order: its rooms lapse together.
  const holds = new Map<string, { uid: string; rooms: typeof rows; expiresAt: Date | null }>();
  for (const b of rows) {
    if (b.status !== "PENDING" || !b.order) continue;
    const h = holds.get(b.order.uid) ?? { uid: b.order.uid, rooms: [], expiresAt: b.order.holdExpiresAt };
    h.rooms.push(b);
    holds.set(b.order.uid, h);
  }

  const schedule = buildEventSchedule(roomSettings.eventDays).map((d) => {
    const open = d.openSlotStartsUtc[0]?.getTime() ?? 0;
    const close =
      (d.openSlotStartsUtc[d.openSlotStartsUtc.length - 1]?.getTime() ?? open) + SLOT_GRANULARITY_MS;
    return { date: d.date, open, close };
  });
  // One shared hour axis, so a short day reads as short rather than stretched.
  // Open and close as a time of day (UTC), shared across days for one axis.
  const openOffset = Math.min(...schedule.map((d) => d.open - Math.floor(d.open / (24 * HOUR)) * 24 * HOUR));
  const closeOffset = Math.max(
    ...schedule.map((d) => d.close - Math.floor(d.open / (24 * HOUR)) * 24 * HOUR)
  );
  const axisHours = Math.max(1, Math.round((closeOffset - openOffset) / HOUR));

  const link =
    "text-[#000643] underline decoration-[#000643]/30 underline-offset-2 hover:decoration-[#000643]";

  return (
    <div className="grid gap-5">
      <header>
        <h1 className="font-bold text-2xl text-[#000643] tracking-tight">My bookings</h1>
        <p className="mt-1 text-gray-600 text-sm">One room per day at NATO Edge 26 · Türkiye time (TRT)</p>
      </header>

      {Array.from(holds.values()).map((h) => (
        <section
          key={h.uid}
          aria-label="Payment needed"
          className="flex flex-col gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex gap-3">
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-amber-100 text-amber-700">
              <Clock3 className="h-4 w-4" aria-hidden />
            </span>
            <div>
              <p className="font-semibold text-amber-950 text-sm">
                {h.rooms.map((r) => `${r.resource.name} on ${fmtDay(r.startTime.toISOString())}`).join(", ")}{" "}
                {h.rooms.length === 1 ? "is" : "are"} held for you
              </p>
              <p className="mt-0.5 text-amber-900/80 text-xs">
                Pay before the hold ends, or the {h.rooms.length === 1 ? "room goes" : "rooms go"} back on
                sale. {h.expiresAt ? <HoldCountdown expiresAt={h.expiresAt.toISOString()} /> : null}
              </p>
            </div>
          </div>
          <ResumePaymentButton uid={h.uid} />
        </section>
      ))}

      {rows.length === 0 ? (
        <section className="rounded-xl border border-gray-200 bg-white p-8 text-center">
          <p className="font-semibold text-[#000643]">You have no bookings yet.</p>
          <p className="mt-1 text-gray-500 text-sm">Each exhibitor can book one meeting room per day.</p>
          <Link
            href="/rooms"
            className="mt-4 inline-block rounded-lg bg-[#000643] px-4 py-2 font-semibold text-sm text-white transition hover:opacity-90">
            Book a room
          </Link>
        </section>
      ) : (
        <>
          {/* The three days as a timeline. Hidden on a phone, where the cards
              below carry the same thing in a form that fits. */}
          <section
            aria-label="Your three days"
            className="hidden rounded-xl border border-gray-200 bg-white p-4 sm:block">
            <div className="grid grid-cols-[6.5rem_minmax(0,1fr)] gap-x-3">
              <span />
              <div className="relative h-5" aria-hidden>
                {Array.from({ length: axisHours + 1 }, (_, i) => (
                  <span
                    key={i}
                    className="absolute text-[11px] text-gray-500 tabular-nums"
                    style={{
                      left: `${(i / axisHours) * 100}%`,
                      transform:
                        i === 0 ? "none" : i === axisHours ? "translateX(-100%)" : "translateX(-50%)",
                    }}>
                    {fmtTime(
                      new Date(
                        schedule[0].open - (schedule[0].open % (24 * HOUR)) + openOffset + i * HOUR
                      ).toISOString()
                    )}
                  </span>
                ))}
              </div>
              {schedule.map((day) => {
                const base = day.open - (day.open % (24 * HOUR)) + openOffset;
                const pct = (ms: number) => ((ms - base) / (axisHours * HOUR)) * 100;
                const onDay = live.filter(
                  (b) => b.startTime.getTime() >= day.open && b.startTime.getTime() < day.close
                );
                return (
                  <div key={day.date} className="contents">
                    <div className="border-gray-100 border-t py-2.5">
                      <p className="font-semibold text-[#000643] text-sm">
                        {fmtDay(new Date(day.open).toISOString())}
                      </p>
                      <p className="text-gray-500 text-xs">{onDay[0]?.resource.name ?? "Free"}</p>
                    </div>
                    <div
                      className="relative my-2 h-9 rounded-md bg-gray-50"
                      style={{
                        backgroundImage: "linear-gradient(to right, #e8eaf0 1px, transparent 1px)",
                        backgroundSize: `calc(100% / ${axisHours}) 100%`,
                      }}>
                      {pct(day.close) < 100 ? (
                        <span
                          className="absolute inset-y-0 right-0 rounded-r-md"
                          style={{
                            left: `${pct(day.close)}%`,
                            background:
                              "repeating-linear-gradient(135deg, #dfe2e8 0 4px, transparent 4px 9px)",
                          }}
                          title={`Rooms close at ${fmtTime(new Date(day.close).toISOString())}`}
                          aria-hidden
                        />
                      ) : null}
                      {onDay.length === 0 ? (
                        <Link
                          href="/rooms"
                          className="absolute inset-0 grid place-items-center text-gray-500 text-xs hover:text-[#000643]">
                          No room booked this day — book one
                        </Link>
                      ) : (
                        onDay.map((b) => {
                          const held = b.status === "PENDING";
                          return (
                            <span
                              key={b.uid}
                              title={`${b.resource.name} · ${fmtTime(b.startTime.toISOString())}–${fmtTime(b.endTime.toISOString())}`}
                              className={`absolute top-1 bottom-1 overflow-hidden whitespace-nowrap rounded px-2 text-xs leading-[26px] ${
                                held ? "text-amber-950" : "text-[#000643]"
                              }`}
                              style={{
                                left: `${pct(b.startTime.getTime())}%`,
                                width: `calc(${pct(b.endTime.getTime()) - pct(b.startTime.getTime())}% - 2px)`,
                                background: held ? HATCH.held : "#e9ebf7",
                                border: `1px solid ${held ? "#f5c46b" : "#c9cde8"}`,
                              }}>
                              {/* A one-hour block is an eighth of the day: too narrow
                                  for a range, which was cut to "14:00–15:0". The
                                  start alone says it; the full range is in the title. */}
                              <span className="font-semibold tabular-nums">
                                {b.durationMinutes <= 60
                                  ? fmtTime(b.startTime.toISOString())
                                  : `${fmtTime(b.startTime.toISOString())}–${fmtTime(b.endTime.toISOString())}`}
                              </span>
                              {held && b.durationMinutes > 60 ? " · awaiting payment" : ""}
                            </span>
                          );
                        })
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
            {schedule.some((d) => (d.close - d.open) / HOUR < axisHours) ? (
              <p className="mt-1 text-gray-500 text-xs">Hatched: the rooms are closed at that time.</p>
            ) : null}
          </section>

          {/* Desktop: every room with its documents. */}
          <section
            aria-label="Bookings"
            className="hidden overflow-x-auto rounded-xl border border-gray-200 bg-white sm:block">
            <table className="w-full min-w-[40rem] text-left text-[13px]">
              <thead>
                <tr className="border-gray-200 border-b bg-gray-50/80 text-[10.5px] text-gray-500 uppercase tracking-[0.05em]">
                  <th className="px-4 py-2.5 font-semibold">When</th>
                  <th className="px-4 py-2.5 font-semibold">Room</th>
                  <th className="px-4 py-2.5 font-semibold">Status</th>
                  <th className="whitespace-nowrap px-4 py-2.5 text-right font-semibold">Excl. VAT</th>
                  <th className="px-4 py-2.5 font-semibold">Document</th>
                  <th className="px-4 py-2.5 font-semibold">Calendar</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((b) => (
                  <tr
                    key={b.uid}
                    className={`border-gray-100 border-b align-top last:border-0 ${b.shown === "CANCELLED" ? "text-gray-400" : ""}`}>
                    <td className="whitespace-nowrap px-4 py-3 tabular-nums">
                      {fmtDay(b.startTime.toISOString())}
                      <div className="font-semibold">
                        {fmtTime(b.startTime.toISOString())}–{fmtTime(b.endTime.toISOString())}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <span className="whitespace-nowrap font-semibold text-[#000643]">
                        {b.resource.name}
                      </span>
                      <div className="text-gray-500 text-xs">
                        {b.addOns.length
                          ? b.addOns.map((a) => `${a.addOn.name} × ${a.quantity}`).join(", ")
                          : `${b.durationMinutes / 60} h`}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <StatusPill status={b.shown} />
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-right font-semibold tabular-nums">
                      {fmtMoney(b.amountTotal, b.currency)}
                    </td>
                    <td className="px-4 py-3">
                      {/* Both documents once a booking is credited. The invoice
                          does not stop existing when a credit note cancels it —
                          the pair is what reconciles in the exhibitor's accounts,
                          and this page is where they come back for it when the
                          emails are gone. */}
                      {b.order?.invoiceNumber ? (
                        <div className="grid gap-1">
                          <a
                            href={`/rooms/invoice/${b.documentUid}`}
                            target="_blank"
                            rel="noreferrer"
                            className={`inline-flex items-center gap-1 whitespace-nowrap ${link}`}>
                            <FileText className="h-3.5 w-3.5" aria-hidden />
                            Invoice {b.order.invoiceNumber}
                          </a>
                          {b.order.creditNoteNumber ? (
                            <a
                              href={`/rooms/credit-note/${b.documentUid}`}
                              target="_blank"
                              rel="noreferrer"
                              className={`inline-flex items-center gap-1 whitespace-nowrap ${link}`}>
                              <FileText className="h-3.5 w-3.5" aria-hidden />
                              Credit note {b.order.creditNoteNumber}
                            </a>
                          ) : null}
                        </div>
                      ) : b.status === "PENDING" ? (
                        <span className="text-amber-800 text-xs">Awaiting payment</span>
                      ) : (
                        <span className="text-gray-300">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {b.status === "CONFIRMED" ? (
                        <a
                          href={`/rooms/bookings/calendar?booking=${b.uid}`}
                          className={`inline-flex items-center gap-1 ${link}`}>
                          <CalendarPlus className="h-3.5 w-3.5" aria-hidden />
                          .ics
                        </a>
                      ) : (
                        <span className="text-gray-300">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>

          {/* Phone: one card per room, the time first — what someone looks for in a corridor. */}
          <section aria-label="Bookings" className="grid gap-3 sm:hidden">
            {rows.map((b) => {
              const day = schedule.find(
                (d) => b.startTime.getTime() >= d.open && b.startTime.getTime() < d.close
              );
              const span = day ? day.close - day.open : 1;
              const left = day ? ((b.startTime.getTime() - day.open) / span) * 100 : 0;
              const width = day ? ((b.endTime.getTime() - b.startTime.getTime()) / span) * 100 : 0;
              return (
                <article
                  key={b.uid}
                  className={`rounded-xl border border-gray-200 bg-white p-4 ${b.shown === "CANCELLED" ? "opacity-60" : ""}`}>
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-semibold text-[#000643] text-sm">
                      {fmtDayLong(b.startTime.toISOString())}
                    </span>
                    <StatusPill status={b.shown} />
                  </div>
                  <div className="mt-2 flex items-baseline justify-between gap-2">
                    <span className="font-bold text-[#000643] text-lg tabular-nums">
                      {fmtTime(b.startTime.toISOString())}–{fmtTime(b.endTime.toISOString())}
                    </span>
                    <span className="font-semibold tabular-nums">{fmtMoney(b.amountTotal, b.currency)}</span>
                  </div>
                  <p className="text-gray-600 text-sm">
                    {b.resource.name}
                    {b.addOns.length
                      ? ` · ${b.addOns.map((a) => `${a.addOn.name} × ${a.quantity}`).join(", ")}`
                      : ""}
                  </p>
                  {day ? (
                    <div className="mt-2 flex items-center gap-2 text-[10px] text-gray-400 tabular-nums">
                      {fmtTime(new Date(day.open).toISOString())}
                      <span className="relative h-1.5 flex-1 rounded-full bg-gray-100" aria-hidden>
                        <span
                          className="absolute inset-y-0 rounded-full"
                          style={{
                            left: `${left}%`,
                            width: `${width}%`,
                            background: b.status === "PENDING" ? "#f59e0b" : "#000643",
                          }}
                        />
                      </span>
                      {fmtTime(new Date(day.close).toISOString())}
                    </div>
                  ) : null}
                  <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 border-gray-100 border-t pt-3 text-sm">
                    {b.order?.invoiceNumber ? (
                      <a
                        href={`/rooms/invoice/${b.documentUid}`}
                        target="_blank"
                        rel="noreferrer"
                        className={link}>
                        Invoice {b.order.invoiceNumber}
                      </a>
                    ) : null}
                    {b.order?.creditNoteNumber ? (
                      <a
                        href={`/rooms/credit-note/${b.documentUid}`}
                        target="_blank"
                        rel="noreferrer"
                        className={link}>
                        Credit note {b.order.creditNoteNumber}
                      </a>
                    ) : null}
                    {b.status === "CONFIRMED" ? (
                      <a href={`/rooms/bookings/calendar?booking=${b.uid}`} className={link}>
                        Add to calendar
                      </a>
                    ) : null}
                    {b.status === "PENDING" ? (
                      <span className="text-amber-800 text-xs">Awaiting payment — see above</span>
                    ) : null}
                  </div>
                </article>
              );
            })}
          </section>

          {live.some((b) => b.status === "CONFIRMED") ? (
            <a
              href="/rooms/bookings/calendar"
              className={`inline-flex items-center gap-1.5 justify-self-start text-sm ${link}`}>
              <CalendarPlus className="h-4 w-4" aria-hidden />
              Add all my confirmed bookings to my calendar
            </a>
          ) : null}
        </>
      )}
    </div>
  );
}
