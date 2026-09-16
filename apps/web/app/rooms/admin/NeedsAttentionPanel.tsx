"use client";

import type { AttentionItem, AttentionSeverity } from "@calcom/features/ne26-rooms/lib/needsAttention";
import { AlertTriangle, CheckCircle2, Clock3, Info, OctagonAlert } from "lucide-react";
import Link from "next/link";
import { fmtCountdown } from "./format";
import { useNow } from "./ui";

const TONE: Record<
  AttentionSeverity,
  { Icon: typeof Info; badge: string; title: string; row: string; button: string }
> = {
  critical: {
    Icon: OctagonAlert,
    badge: "bg-red-100 text-red-700",
    title: "text-red-900",
    // The whole row is tinted: it is the one that costs money.
    row: "bg-red-50/60",
    button: "bg-[#000643] text-white hover:opacity-90",
  },
  warning: {
    Icon: AlertTriangle,
    badge: "bg-amber-100 text-amber-700",
    title: "text-amber-950",
    row: "",
    button: "bg-[#000643] text-white hover:opacity-90",
  },
  info: {
    Icon: Info,
    badge: "bg-indigo-50 text-indigo-600",
    title: "text-gray-900",
    row: "",
    button: "border border-gray-200 bg-white text-[#000643] hover:border-[#000643]",
  },
};

/**
 * One list of what needs a person, most costly first. The ranking lives in
 * lib/needsAttention; this only draws it and keeps the hold clocks moving.
 */
export default function NeedsAttentionPanel({ items }: { items: AttentionItem[] }): JSX.Element {
  const now = useNow();
  const urgent = items.filter((i) => i.severity !== "info").length;

  if (items.length === 0) {
    return (
      <section
        aria-label="Needs attention"
        className="flex items-center gap-3 rounded-xl border border-gray-200 bg-white px-4 py-3.5">
        <span className="grid h-8 w-8 place-items-center rounded-full bg-green-50 text-green-600">
          <CheckCircle2 className="h-4 w-4" aria-hidden />
        </span>
        <div>
          <p className="font-semibold text-gray-900 text-sm">Nothing needs attention</p>
          <p className="text-gray-500 text-xs">
            No unpaid holds ending, no missing invoices, no payment without a room.
          </p>
        </div>
      </section>
    );
  }

  return (
    <section
      aria-labelledby="attention-h"
      className="overflow-hidden rounded-xl border border-gray-200 bg-white">
      <header className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
        <h2 id="attention-h" className="flex items-center gap-2 font-semibold text-[#000643] text-[15px]">
          Needs attention
          {urgent > 0 ? (
            <span className="rounded-full bg-red-600 px-1.5 font-bold text-[11px] text-white tabular-nums leading-[18px]">
              {urgent}
            </span>
          ) : null}
        </h2>
        <span className="text-gray-500 text-xs">Most costly first</span>
      </header>
      <ul>
        {items.map((item) => {
          const tone = TONE[item.severity];
          const msLeft = item.expiresAt && now ? new Date(item.expiresAt).getTime() - now.getTime() : null;
          const title =
            item.kind === "hold-expiring" && msLeft !== null
              ? `Hold ends in ${fmtCountdown(msLeft)}`
              : item.title;
          return (
            <li
              key={item.id}
              className={`grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-3 gap-y-2 border-gray-100 border-t px-4 py-3 sm:grid-cols-[auto_minmax(0,1fr)_auto] ${tone.row}`}>
              <span className={`grid h-8 w-8 place-items-center rounded-full ${tone.badge}`}>
                {item.kind === "hold-expiring" ? (
                  <Clock3 className="h-4 w-4" aria-hidden />
                ) : (
                  <tone.Icon className="h-4 w-4" aria-hidden />
                )}
              </span>
              <div className="min-w-0">
                <p className={`font-semibold text-sm tabular-nums ${tone.title}`}>{title}</p>
                <p className="text-gray-600 text-xs">{item.detail}</p>
              </div>
              {item.href && item.actionLabel ? (
                <Link
                  href={item.href}
                  className={`col-start-2 justify-self-start whitespace-nowrap rounded-lg px-3 py-1.5 font-semibold text-xs transition sm:col-start-3 sm:justify-self-end ${tone.button}`}>
                  {item.actionLabel}
                </Link>
              ) : null}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
