"use client";

import type { KitchenDay } from "@calcom/features/ne26-rooms/lib/kitchenSheet";
import { Printer } from "lucide-react";
import { fmtDayLong, fmtTime } from "../format";

function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/**
 * Print only the sheet, in its own window: printing this page would print the
 * site header, the admin navigation and the catalogue editor with it.
 */
function printSheet(days: KitchenDay[]): void {
  const body = days
    .map((day) => {
      const rows = day.items
        .map(
          (item) => `
          <tr><th colspan="3">${escapeHtml(item.name)} — ${item.confirmed} confirmed${
            item.held ? `, +${item.held} on hold` : ""
          }</th></tr>
          ${item.deliveries
            .map(
              (d) =>
                `<tr><td>${fmtTime(d.startUtc)}–${fmtTime(d.endUtc)}</td><td>${escapeHtml(d.roomName)}</td><td>${d.quantity}${
                  d.held ? " (on hold)" : ""
                }</td></tr>`
            )
            .join("")}`
        )
        .join("");
      return `<h2>${escapeHtml(fmtDayLong(day.openUtc))}</h2>${
        day.items.length ? `<table>${rows}</table>` : "<p>Nothing ordered.</p>"
      }`;
    })
    .join("");
  const w = window.open("", "_blank", "width=800,height=900");
  if (!w) return;
  w.document.write(`<!doctype html><title>NE26 kitchen sheet</title>
    <style>
      body{font:13px/1.45 -apple-system,Segoe UI,Helvetica,Arial,sans-serif;color:#111;margin:24px}
      h1{font-size:18px;margin:0 0 4px}p.m{color:#666;margin:0 0 16px}
      h2{font-size:15px;margin:22px 0 6px;border-bottom:1px solid #999;padding-bottom:3px;page-break-after:avoid}
      table{width:100%;border-collapse:collapse}th{text-align:left;padding:8px 0 3px}
      td{padding:2px 8px 2px 0;border-bottom:1px solid #eee;font-variant-numeric:tabular-nums}
    </style>
    <h1>NATO Edge 26 — kitchen sheet</h1><p class="m">Times in TRT. Printed ${escapeHtml(new Date().toLocaleString("en-GB"))}.</p>${body}`);
  w.document.close();
  w.focus();
  w.print();
}

/**
 * What the kitchen must prepare, day by day — above the catalogue, because it
 * is the question asked of this page most often during the event.
 */
export default function KitchenSheet({ days }: { days: KitchenDay[] }): JSX.Element {
  return (
    <section aria-labelledby="kitchen-h" className="mt-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 id="kitchen-h" className="font-semibold text-[#000643] text-[15px]">
            Kitchen sheet
          </h2>
          <p className="text-gray-500 text-xs">
            Portions per day, confirmed and still on hold. Held portions can disappear within 35 minutes.
          </p>
        </div>
        <button
          type="button"
          onClick={() => printSheet(days)}
          className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 py-1.5 font-semibold text-[#000643] text-[13px] transition hover:border-[#000643]">
          <Printer className="h-3.5 w-3.5" aria-hidden />
          Print kitchen sheet
        </button>
      </div>

      <div className="mt-3 grid items-start gap-4 md:grid-cols-3">
        {days.map((day) => (
          <article key={day.date} className="rounded-xl border border-gray-200 bg-white p-4">
            <h3 className="font-semibold text-[#000643] text-sm">{fmtDayLong(day.openUtc)}</h3>
            {day.items.length === 0 ? (
              <p className="mt-2 text-gray-400 text-sm">Nothing ordered yet.</p>
            ) : (
              <ul className="mt-2 grid gap-3">
                {day.items.map((item) => (
                  <li key={item.name} className="border-gray-100 border-t pt-2.5 first:border-0 first:pt-0">
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="font-medium text-gray-900 text-sm">{item.name}</span>
                      <span className="shrink-0 tabular-nums">
                        <span className="font-bold text-[#000643] text-lg">{item.confirmed}</span>
                        {item.held ? (
                          <span className="ml-1 font-semibold text-amber-700 text-xs">+{item.held} held</span>
                        ) : null}
                      </span>
                    </div>
                    <ul className="mt-1 grid gap-0.5 text-gray-600 text-xs">
                      {item.deliveries.map((d) => (
                        <li
                          key={`${d.bookingUid}-${item.name}`}
                          className="flex justify-between gap-2 tabular-nums">
                          <span className="truncate">
                            {fmtTime(d.startUtc)} · {d.roomName}
                          </span>
                          <span className={d.held ? "text-amber-700" : ""}>
                            {d.quantity}
                            {d.held ? " held" : ""}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </li>
                ))}
              </ul>
            )}
          </article>
        ))}
      </div>
    </section>
  );
}
