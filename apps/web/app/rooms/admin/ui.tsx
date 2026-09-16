"use client";

import { useEffect, useState } from "react";

/**
 * The admin's small parts. Deliberately few: a status pill, a section card and
 * a live clock. Severity and emphasis are carried by tint, icon and weight —
 * never by a coloured stripe down one side of a box.
 */

const PILL: Record<string, { label: string; className: string }> = {
  CONFIRMED: { label: "Confirmed", className: "bg-green-50 text-green-700 ring-green-600/15" },
  PENDING: { label: "Pending", className: "bg-amber-50 text-amber-800 ring-amber-600/20" },
  REFUNDED: { label: "Refunded", className: "bg-blue-50 text-blue-700 ring-blue-600/15" },
  CANCELLED: { label: "Cancelled", className: "bg-gray-100 text-gray-500 ring-gray-500/10" },
};

export function StatusPill({ status }: { status: string }): JSX.Element {
  const pill = PILL[status] ?? { label: status, className: "bg-gray-100 text-gray-600 ring-gray-500/10" };
  return (
    <span
      className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2 py-0.5 font-semibold text-[11px] ring-1 ring-inset ${pill.className}`}>
      <span className="h-1.5 w-1.5 rounded-full bg-current" aria-hidden />
      {pill.label}
    </span>
  );
}

export function Card({
  children,
  className = "",
  as: Tag = "section",
}: {
  children: React.ReactNode;
  className?: string;
  as?: "section" | "div" | "aside";
}): JSX.Element {
  return <Tag className={`rounded-xl border border-gray-200 bg-white ${className}`}>{children}</Tag>;
}

export function Eyebrow({ children }: { children: React.ReactNode }): JSX.Element {
  return <p className="font-semibold text-[11px] text-gray-500 uppercase tracking-[0.07em]">{children}</p>;
}

/**
 * The current time, ticking — but only once mounted. Rendered on the server it
 * would disagree with the browser by however long the page took to arrive, and
 * React would throw the whole tree away over a countdown.
 */
export function useNow(intervalMs = 1000): Date | null {
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    setNow(new Date());
    const id = setInterval(() => setNow(new Date()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}

/** Diagonal hatching for things that are not sold: holds, blocks, cleaning. */
export const HATCH = {
  held: "repeating-linear-gradient(45deg, #fef3c7 0 6px, #fde68a 6px 12px)",
  blocked: "repeating-linear-gradient(135deg, #f3f4f6 0 5px, #e5e7eb 5px 10px)",
  cleaning: "repeating-linear-gradient(135deg, #d6dae3 0 2px, transparent 2px 5px)",
};
