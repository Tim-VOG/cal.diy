"use client";

import { EVENT_TIME_ZONE } from "@calcom/features/ne26-rooms/lib/eventSchedule";
import { trpc } from "@calcom/trpc/react";
import { Trash2 } from "lucide-react";
import { useState } from "react";

/**
 * The accounts, as opposed to the people who have bought something.
 *
 * The list below this one is built from BOOKINGS, so an exhibitor who registered
 * and never got as far as paying appears nowhere — which is most of them before
 * the doors open, and every account made while testing. There was no way to see
 * those, let alone remove one.
 */

function when(iso: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: EVENT_TIME_ZONE,
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(new Date(iso));
}

export default function BookerAccounts(): JSX.Element | null {
  const accounts = trpc.viewer.rooms.listBookerAccounts.useQuery();
  const [note, setNote] = useState<string | null>(null);
  const remove = trpc.viewer.rooms.deleteBookerAccount.useMutation({
    onSuccess: (result) => {
      setNote(
        result.ordersKept > 0
          ? `Account deleted. ${result.ordersDeleted} booking(s) removed; ${result.ordersKept} kept, because they carry an invoice or a credit note.`
          : `Account deleted, with ${result.ordersDeleted} booking(s).`
      );
      accounts.refetch();
    },
    onError: (e) => setNote(e.message),
  });

  const rows = accounts.data ?? [];

  return (
    <section className="mb-8">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="font-bold text-[#000643] text-xl">Exhibitor accounts</h2>
        <p className="text-gray-500 text-sm">
          {accounts.isLoading ? "Loading…" : `${rows.length} registered`}
        </p>
      </div>
      <p className="mt-1 text-gray-500 text-sm">
        Everyone who has registered, including those who have not booked yet. Staff are managed on the Access
        page.
      </p>

      {note ? (
        <p className="mt-3 rounded-lg bg-gray-50 px-3 py-2 text-gray-700 text-sm" role="status">
          {note}
        </p>
      ) : null}

      {rows.length === 0 && !accounts.isLoading ? (
        <p className="mt-3 text-gray-400 text-sm">No exhibitor accounts yet.</p>
      ) : (
        <div className="mt-3 overflow-x-auto rounded-xl border border-gray-200 bg-white">
          <table className="w-full text-sm">
            <thead className="border-gray-100 border-b text-gray-500 text-xs uppercase tracking-wide">
              <tr>
                <th className="px-4 py-2 text-left font-semibold">Email</th>
                <th className="px-4 py-2 text-left font-semibold">Name</th>
                <th className="px-4 py-2 text-left font-semibold">Registered</th>
                <th className="px-4 py-2 text-right font-semibold">Bookings</th>
                <th className="px-4 py-2" />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {rows.map((a) => {
                const total = a.undocumentedOrders + a.documentedOrders;
                return (
                  <tr key={a.userId} className="hover:bg-gray-50">
                    <td className="px-4 py-2 font-medium text-gray-900">{a.email}</td>
                    <td className="px-4 py-2 text-gray-600">{a.name || "—"}</td>
                    <td className="px-4 py-2 text-gray-500">{when(a.createdAt as unknown as string)}</td>
                    <td className="px-4 py-2 text-right tabular-nums">
                      {total === 0 ? <span className="text-gray-400">none</span> : total}
                      {/* What survives them is the part worth stating up front,
                          not in the confirmation after they have decided. */}
                      {a.documentedOrders > 0 ? (
                        <span className="ml-1 text-gray-500 text-xs">({a.documentedOrders} invoiced)</span>
                      ) : null}
                    </td>
                    <td className="px-4 py-2 text-right">
                      <button
                        type="button"
                        disabled={remove.isPending}
                        onClick={() => {
                          const kept =
                            a.documentedOrders > 0
                              ? ` ${a.documentedOrders} invoiced booking(s) will be kept — they carry a document.`
                              : "";
                          const gone =
                            a.undocumentedOrders > 0
                              ? ` ${a.undocumentedOrders} booking(s) will be deleted and their rooms go back on sale.`
                              : "";
                          if (window.confirm(`Delete the account for ${a.email}?${gone}${kept}`)) {
                            setNote(null);
                            remove.mutate({ userId: a.userId });
                          }
                        }}
                        className="inline-flex items-center gap-1 rounded-lg border border-red-200 px-2.5 py-1 font-medium text-red-600 text-xs transition hover:border-red-400 disabled:opacity-40">
                        <Trash2 className="h-3 w-3" aria-hidden />
                        Delete
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
