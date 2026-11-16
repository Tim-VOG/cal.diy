"use client";

import { describeExtension } from "@calcom/features/ne26-rooms/lib/bookingExtension";
import { trpc } from "@calcom/trpc/react";
import { Clock3 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { fmtDay, fmtTime } from "../../format";
import { HATCH } from "../../ui";

const HOUR_MS = 3_600_000;

export interface PlanDay {
  date: string;
  /** First and last bookable minute of the day, in epoch ms. */
  openMs: number;
  closeMs: number;
}
export interface PlanRoom {
  uid: string;
  name: string;
  startMs: number;
  endMs: number;
  status: string;
  /** Credit note that took it off sale, when one did. */
  creditedLabel?: string;
}
export interface PlanContinuation {
  uid: string;
  startMs: number;
  endMs: number;
  durationMinutes: number;
  status: string;
}
export interface ExtendableRoom {
  uid: string;
  name: string;
  whenLabel: string;
  startMs: number;
  endMs: number;
  /** Quarter-hours already held in this room, so the form can refuse early. */
  takenMs: number[];
}

const field =
  "mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-[#000643] focus:outline-none";

function Section({ title, children }: { title: string; children: React.ReactNode }): JSX.Element {
  return (
    <section className="rounded-xl border border-gray-200 bg-white p-4">
      <h2 className="font-semibold text-[11px] text-gray-500 uppercase tracking-[0.07em]">{title}</h2>
      <div className="mt-2">{children}</div>
    </section>
  );
}

/**
 * The order's plan, and the form that sells extra time on it.
 *
 * One component because they share a selection. The form used to sit apart and
 * let a hostess pick a direction and a length that could not possibly be sold —
 * with a room booked back to back all day, every choice refused with "one of
 * those rooms was just taken" and nothing on the page hinted at why. The choice
 * is now drawn on the band as it is made: where the extra time would fall, and
 * whether anybody else is already there.
 *
 * The preview is a convenience, not an authority. The server asks for no
 * availability before writing, because the unique index on
 * (resourceId, slotStart) is what actually decides, and anything read
 * beforehand is a guess that a concurrent buyer can invalidate.
 */
export default function PlanAndExtraTime({
  days,
  rooms,
  continuations,
  extendable,
  openMarks,
  bufferMinutes,
  hasCancelled,
}: {
  days: PlanDay[];
  rooms: PlanRoom[];
  continuations: PlanContinuation[];
  extendable: ExtendableRoom[];
  openMarks: number[];
  bufferMinutes: number;
  hasCancelled: boolean;
}): JSX.Element {
  const router = useRouter();
  const [uid, setUid] = useState(extendable[0]?.uid ?? "");
  const [direction, setDirection] = useState<"before" | "after">("after");
  const [durationHours, setDurationHours] = useState<1 | 2 | 3>(1);

  const extend = trpc.viewer.rooms.extendBooking.useMutation({ onSuccess: () => router.refresh() });

  const openSet = useMemo(() => new Set(openMarks), [openMarks]);
  const selected = extendable.find((r) => r.uid === uid) ?? extendable[0];

  /**
   * The selected room's occupancy, as blocks rather than a list of marks.
   *
   * Anonymous on purpose: this page is about one order, and whose meeting sits
   * in the next hour is none of its business. What it needs to show is simply
   * whether the hour is free, and a shape says that faster than a refusal
   * after the fact.
   */
  const busyRuns = useMemo(() => {
    if (!selected) return [] as { startMs: number; endMs: number }[];
    const marks = [...selected.takenMs].sort((a, b) => a - b);
    const runs: { startMs: number; endMs: number }[] = [];
    const QUARTER = 15 * 60 * 1000;
    for (const m of marks) {
      const last = runs[runs.length - 1];
      if (last && m === last.endMs) last.endMs = m + QUARTER;
      else runs.push({ startMs: m, endMs: m + QUARTER });
    }
    return runs;
  }, [selected]);

  /** What the current choice would do — drawn on the band, and why it cannot. */
  const preview = useMemo(() => {
    if (!selected) return null;
    const takenSet = new Set(selected.takenMs);
    const outcome = describeExtension({
      parent: {
        uid: selected.uid,
        startTime: new Date(selected.startMs),
        endTime: new Date(selected.endMs),
      },
      direction,
      durationHours,
      bufferMinutes,
      openSlotMs: openSet,
      takenSlotMs: takenSet,
      now: new Date(),
    });
    if (!outcome.plan) return { ok: false as const, reason: outcome.ok ? "" : outcome.reason, span: null };
    return {
      ok: outcome.ok,
      reason: outcome.ok ? "" : outcome.reason,
      span: { startMs: outcome.plan.startTime.getTime(), endMs: outcome.plan.endTime.getTime() },
    };
  }, [selected, direction, durationHours, bufferMinutes, openSet]);

  /** Lengths that would work right now, so the form can say so up front. */
  const offered = useMemo(() => {
    if (!selected) return {} as Record<number, boolean>;
    const takenSet = new Set(selected.takenMs);
    const out: Record<number, boolean> = {};
    for (const h of [1, 2, 3] as const) {
      out[h] = describeExtension({
        parent: {
          uid: selected.uid,
          startTime: new Date(selected.startMs),
          endTime: new Date(selected.endMs),
        },
        direction,
        durationHours: h,
        bufferMinutes,
        openSlotMs: openSet,
        takenSlotMs: takenSet,
        now: new Date(),
      }).ok;
    }
    return out;
  }, [selected, direction, bufferMinutes, openSet]);

  return (
    <>
      <Section title="On the plan — what this order holds across the three days">
        <div className="grid gap-2">
          {days.map((day) => {
            const { openMs: open, closeMs: close } = day;
            const span = Math.max(1, close - open);
            const hours = Math.round(span / HOUR_MS);
            const onDay = rooms.filter((b) => b.endMs > open && b.startMs < close);
            const extraOnDay = continuations.filter((b) => b.endMs > open && b.startMs < close);
            const previewOnDay =
              preview?.span && preview.span.endMs > open && preview.span.startMs < close ? preview : null;
            const place = (startMs: number, endMs: number) => ({
              left: `${((Math.max(startMs, open) - open) / span) * 100}%`,
              width: `calc(${((Math.min(endMs, close) - Math.max(startMs, open)) / span) * 100}% - 2px)`,
            });

            return (
              <div key={day.date} className="grid grid-cols-[5.5rem_minmax(0,1fr)] items-start gap-3">
                <span className="pt-2 text-gray-600 text-xs">{fmtDay(new Date(open).toISOString())}</span>
                <div>
                  <div
                    className="relative h-9 rounded-md border border-gray-100 bg-gray-50"
                    style={{
                      backgroundImage: "linear-gradient(to right, #e8eaf0 1px, transparent 1px)",
                      backgroundSize: `calc(100% / ${hours}) 100%`,
                    }}>
                    {/* The room's occupancy, underneath everything: no names,
                        no times, just the shape of what is taken. The order's
                        own rooms are painted over it below. */}
                    {busyRuns
                      .filter((r) => r.endMs > open && r.startMs < close)
                      .map((r) => (
                        <span
                          key={`busy-${r.startMs}`}
                          className="absolute top-1 bottom-1 rounded-sm"
                          style={{ ...place(r.startMs, r.endMs), background: "#dcdfe6" }}
                          title="Taken"
                          aria-hidden
                        />
                      ))}

                    {/* The choice being made, over the occupancy so a clash is
                        visible, under the rooms so a sold room stays legible. */}
                    {previewOnDay ? (
                      <span
                        className={`absolute top-1 bottom-1 overflow-hidden rounded border-2 border-dashed px-1.5 text-[11px] leading-[22px] ${
                          previewOnDay.ok
                            ? "border-[#000643] text-[#000643]"
                            : "border-red-400 text-red-700"
                        }`}
                        style={{
                          ...place(previewOnDay.span.startMs, previewOnDay.span.endMs),
                          background: previewOnDay.ok ? "#dfe3f6" : HATCH.blocked,
                        }}
                        title={
                          previewOnDay.ok
                            ? "Extra time about to be reserved"
                            : `Cannot be reserved — ${previewOnDay.reason}`
                        }>
                        <span className="truncate font-semibold tabular-nums">
                          {previewOnDay.ok ? "+" : "✕ "}
                          {durationHours}h · {fmtTime(new Date(previewOnDay.span.startMs).toISOString())}–
                          {fmtTime(new Date(previewOnDay.span.endMs).toISOString())}
                        </span>
                      </span>
                    ) : null}

                    {/* Extra time already sold, then the order's own rooms: a
                        room block always wins the overlap, because on this page
                        the rest is context. */}
                    {extraOnDay.map((b) => (
                      <span
                        key={b.uid}
                        className="absolute top-1 bottom-1 overflow-hidden rounded border border-gray-300 border-dashed bg-gray-100 px-1.5 text-[11px] text-gray-500 leading-[26px]"
                        style={place(b.startMs, b.endMs)}
                        title={`Extra time · ${fmtTime(new Date(b.startMs).toISOString())}–${fmtTime(
                          new Date(b.endMs).toISOString()
                        )} · ${b.status === "PENDING" ? "awaiting payment" : "paid"}`}>
                        <span className="truncate tabular-nums">
                          +{b.durationMinutes / 60}h · {fmtTime(new Date(b.startMs).toISOString())}–
                          {fmtTime(new Date(b.endMs).toISOString())}
                        </span>
                      </span>
                    ))}

                    {onDay.map((b) => {
                      const freed = b.status === "CANCELLED";
                      const held = b.status === "PENDING";
                      return (
                        <span
                          key={b.uid}
                          className={`absolute top-1 bottom-1 overflow-hidden rounded px-1.5 text-[11px] leading-[26px] ${
                            freed ? "text-gray-500" : held ? "text-amber-950" : "text-[#000643]"
                          }`}
                          style={{
                            ...place(b.startMs, b.endMs),
                            background: freed ? HATCH.blocked : held ? HATCH.held : "#e9ebf7",
                            border: `1px solid ${freed ? "#d1d5db" : held ? "#f5c46b" : "#c9cde8"}`,
                          }}
                          title={`${b.name} · ${fmtTime(new Date(b.startMs).toISOString())}–${fmtTime(
                            new Date(b.endMs).toISOString()
                          )}`}>
                          {/* Hours first, name second. A one-hour block is about
                              sixty pixels wide, so whatever comes second is
                              truncated — and the time is what is looked up. */}
                          <span className="font-semibold tabular-nums">
                            {fmtTime(new Date(b.startMs).toISOString())}–
                            {fmtTime(new Date(b.endMs).toISOString())}
                          </span>
                          {freed ? " · freed" : ` · ${b.name}`}
                        </span>
                      );
                    })}
                  </div>
                  {/* An hour scale under the band. Without it the blocks sit on
                      an unlabelled grid and the only way to read a time is to
                      hover one. */}
                  <div className="relative mt-0.5 h-3.5">
                    {Array.from({ length: hours + 1 }, (_, i) => {
                      const mark = new Date(open + i * HOUR_MS);
                      const isLast = i === hours;
                      return (
                        <span
                          key={mark.getTime()}
                          className="absolute text-[10px] text-gray-400 tabular-nums"
                          style={
                            isLast
                              ? { right: 0 }
                              : {
                                  left: `${(i / hours) * 100}%`,
                                  transform: i === 0 ? "none" : "translateX(-50%)",
                                }
                          }>
                          {fmtTime(mark.toISOString())}
                        </span>
                      );
                    })}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
        {busyRuns.length > 0 ? (
          <p className="mt-2 text-gray-500 text-xs">
            Solid grey is time already taken in that room, by this order or anyone else — shown so a free
            hour is visible at a glance. No names: this page is about one order.
          </p>
        ) : null}
        {continuations.length > 0 ? (
          <p className="mt-2 text-gray-500 text-xs">
            Dashed grey is extra time sold on these rooms. It sits on its own order and is invoiced
            separately — this order does not charge for it.
          </p>
        ) : null}
        {hasCancelled ? (
          <p className="mt-2 text-gray-500 text-xs">
            Freed rooms went back on sale when the order was cancelled or credited.
          </p>
        ) : null}
      </Section>

      {extendable.length > 0 ? (
        <Section title="Sell extra time">
          <h3 className="flex items-center gap-2 font-semibold text-[#000643] text-base">
            <Clock3 className="h-4 w-4 shrink-0" aria-hidden />
            Extra time on a room they already have
          </h3>
          <p className="mt-1 text-gray-600 text-sm">
            Charged at the normal price for its own length. It becomes a second booking with its own invoice,
            and the payment link is emailed to the exhibitor. The choice is drawn on the plan above.
          </p>

          <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
            {extendable.length > 1 ? (
              <label className="text-sm sm:col-span-3">
                <span className="font-medium text-gray-700">Room</span>
                <select className={field} value={uid} onChange={(e) => setUid(e.target.value)}>
                  {extendable.map((r) => (
                    <option key={r.uid} value={r.uid}>
                      {r.name} · {r.whenLabel}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}

            <label className="text-sm">
              <span className="font-medium text-gray-700">When</span>
              <select
                className={field}
                value={direction}
                onChange={(e) => setDirection(e.target.value as "before" | "after")}>
                <option value="after">Runs later — same start</option>
                <option value="before">Starts earlier — same end</option>
              </select>
            </label>

            <label className="text-sm">
              <span className="font-medium text-gray-700">How much</span>
              <select
                className={field}
                value={durationHours}
                onChange={(e) => setDurationHours(Number(e.target.value) as 1 | 2 | 3)}>
                {([1, 2, 3] as const).map((h) => (
                  <option key={h} value={h}>
                    {h} hour{h > 1 ? "s" : ""}
                    {offered[h] === false ? " — not available" : ""}
                  </option>
                ))}
              </select>
            </label>

            <div className="flex items-end">
              <button
                type="button"
                disabled={extend.isPending || !uid || !preview?.ok}
                onClick={() => extend.mutate({ uid, direction, durationHours })}
                className="w-full rounded-lg bg-[#000643] px-4 py-2 font-semibold text-sm text-white transition hover:opacity-90 disabled:opacity-40">
                {extend.isPending ? "Reserving…" : "Reserve and email the link"}
              </button>
            </div>
          </div>

          {extendable.length === 1 ? (
            <p className="mt-2 text-gray-400 text-xs">
              {extendable[0].name} · {extendable[0].whenLabel}
            </p>
          ) : null}

          {preview && !preview.ok ? (
            <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-amber-800 text-sm">{preview.reason}</p>
          ) : null}
          {extend.error ? <p className="mt-3 text-red-600 text-sm">{extend.error.message}</p> : null}

          {extend.data ? (
            <div className="mt-4 rounded-lg bg-gray-50 px-4 py-3 text-sm">
              <p className="font-semibold text-[#000643]">
                {extend.data.roomName} · {extend.data.slotLabel}
              </p>
              <p className="mt-1 text-gray-600">
                {(extend.data.amountTotal / 100).toFixed(2)} {extend.data.currency} excl. VAT. The room is
                held until that time begins — there is no countdown.
              </p>
              <p className="mt-2 text-gray-600">
                {extend.data.emailed ? (
                  <>
                    Payment link sent to <strong>{extend.data.bookerEmail}</strong>.
                  </>
                ) : (
                  <span className="text-amber-700">
                    The email could not be sent. Pass this link on instead — the booking itself is fine.
                  </span>
                )}
              </p>
              <a
                href={extend.data.checkoutUrl}
                target="_blank"
                rel="noreferrer"
                className="mt-1 block break-all text-[#000643] text-xs underline hover:opacity-80">
                {extend.data.checkoutUrl}
              </a>
            </div>
          ) : null}
        </Section>
      ) : null}
    </>
  );
}
