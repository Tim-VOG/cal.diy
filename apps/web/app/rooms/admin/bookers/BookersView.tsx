"use client";

import { useMemo, useState } from "react";

const TZ = "Europe/Istanbul";

export interface BookerBooking {
  uid: string;
  roomName: string;
  startUtc: string;
  endUtc: string;
  status: string;
  amountTotal: number;
  currency: string;
  invoiceNumber: string | null;
  creditNoteNumber: string | null;
  addOns: { name: string; quantity: number }[];
}

export interface Booker {
  email: string;
  name: string;
  currency: string;
  bookingCount: number;
  confirmedTotal: number;
  bookings: BookerBooking[];
}

const STATUS_BADGE: Record<string, string> = {
  CONFIRMED: "bg-green-100 text-green-700",
  PENDING: "bg-amber-100 text-amber-700",
  CANCELLED: "bg-gray-100 text-gray-500",
};

function money(cents: number, currency: string): string {
  return new Intl.NumberFormat("en-GB", { style: "currency", currency }).format(cents / 100);
}
function fmt(iso: string): string {
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

export default function BookersView({ bookers }: { bookers: Booker[] }): JSX.Element {
  const [query, setQuery] = useState("");
  const [openEmail, setOpenEmail] = useState<string | null>(null);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return bookers;
    return bookers.filter((b) => b.name.toLowerCase().includes(q) || b.email.toLowerCase().includes(q));
  }, [bookers, query]);

  return (
    <div>
      <h1 className="font-bold text-2xl text-[#000643]">Bookers</h1>
      <p className="mt-1 text-gray-600 text-sm">
        Everyone who has booked a room, with what they purchased. Click a booker to expand their bookings.
      </p>

      <input
        type="search"
        placeholder="Search by name or email…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        className="mt-4 w-full max-w-sm rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-[#000643] focus:outline-none"
      />

      <div className="mt-4 space-y-3">
        {filtered.length === 0 ? (
          <p className="text-gray-400 text-sm">No bookers yet.</p>
        ) : (
          filtered.map((b) => {
            const open = openEmail === b.email;
            return (
              <div key={b.email} className="rounded-xl border border-gray-200 bg-white">
                <button
                  type="button"
                  onClick={() => setOpenEmail(open ? null : b.email)}
                  className="flex w-full items-center justify-between gap-4 px-5 py-4 text-left">
                  <div className="min-w-0">
                    <p className="truncate font-semibold text-[#000643]">{b.name}</p>
                    <p className="truncate text-gray-500 text-sm">{b.email}</p>
                  </div>
                  <div className="flex shrink-0 items-center gap-6 text-sm">
                    <span className="text-gray-500">
                      {b.bookingCount} booking{b.bookingCount > 1 ? "s" : ""}
                    </span>
                    <span className="font-semibold text-[#000643]">
                      {money(b.confirmedTotal, b.currency)}
                    </span>
                    <span className="text-gray-400">{open ? "▲" : "▼"}</span>
                  </div>
                </button>

                {open ? (
                  <div className="overflow-x-auto border-gray-100 border-t px-5 py-3">
                    <table className="w-full min-w-[36rem] text-left text-sm">
                      <thead className="text-gray-400 text-xs uppercase">
                        <tr>
                          <th className="py-1">Room</th>
                          <th className="py-1">When</th>
                          <th className="py-1">Add-ons</th>
                          <th className="py-1">Status</th>
                          <th className="py-1 text-right">Amount</th>
                          <th className="py-1 text-right">Invoice</th>
                        </tr>
                      </thead>
                      <tbody>
                        {b.bookings.map((bk) => (
                          <tr key={bk.uid} className="border-gray-50 border-b last:border-0">
                            <td className="py-2 font-medium">{bk.roomName}</td>
                            <td className="py-2 text-gray-600">
                              {fmt(bk.startUtc)} – {fmt(bk.endUtc)}
                            </td>
                            <td className="py-2 text-gray-600">
                              {bk.addOns.length === 0
                                ? "—"
                                : bk.addOns.map((a) => `${a.name}×${a.quantity}`).join(", ")}
                            </td>
                            <td className="py-2">
                              <span
                                className={`inline-block rounded-full px-2 py-0.5 font-medium text-xs ${STATUS_BADGE[bk.status] ?? ""}`}>
                                {bk.status}
                              </span>
                            </td>
                            <td className="py-2 text-right">{money(bk.amountTotal, bk.currency)}</td>
                            <td className="py-2 text-right">
                              {bk.creditNoteNumber ? (
                                <a
                                  href={`/rooms/credit-note/${bk.uid}`}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="text-[#000643] underline">
                                  {bk.creditNoteNumber}
                                </a>
                              ) : bk.invoiceNumber ? (
                                <a
                                  href={`/rooms/invoice/${bk.uid}`}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="text-[#000643] underline">
                                  {bk.invoiceNumber}
                                </a>
                              ) : (
                                "—"
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : null}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
