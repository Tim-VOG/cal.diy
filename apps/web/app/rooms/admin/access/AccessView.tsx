"use client";

import { trpc } from "@calcom/trpc/react";
import { ShieldCheck, Trash2, UserPlus } from "lucide-react";
import { useState } from "react";
import DeskModeCard from "./DeskModeCard";
import { EVENT_TIME_ZONE } from "@calcom/features/ne26-rooms/lib/eventSchedule";

const inputClass =
  "w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-[#000643] focus:outline-none";

const ROLE_LABEL: Record<string, string> = {
  ADMIN: "Administrator",
  HOSTESS: "Hostess",
};

function RoleBadge({ role }: { role: "ADMIN" | "HOSTESS" }): JSX.Element {
  const isAdmin = role === "ADMIN";
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-medium text-xs ${
        isAdmin ? "bg-[#000643] text-white" : "bg-[#000643]/10 text-[#000643]"
      }`}>
      {isAdmin ? <ShieldCheck className="h-3 w-3" aria-hidden /> : null}
      {ROLE_LABEL[role]}
    </span>
  );
}

function when(value: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: EVENT_TIME_ZONE,
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(value));
}

export default function AccessView(): JSX.Element {
  const staff = trpc.viewer.rooms.staff.useQuery();
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<"ADMIN" | "HOSTESS">("HOSTESS");

  const grant = trpc.viewer.rooms.grantRole.useMutation({
    onSuccess: () => {
      setEmail("");
      void staff.refetch();
    },
  });
  const revoke = trpc.viewer.rooms.revokeRole.useMutation({
    onSuccess: () => void staff.refetch(),
  });

  const members = staff.data?.members ?? [];
  const actions = staff.data?.actions ?? [];
  const error = grant.error?.message ?? revoke.error?.message ?? null;

  return (
    <div className="grid grid-cols-1 items-start gap-8 xl:grid-cols-[minmax(320px,28rem)_1fr]">
      <DeskModeCard />

      <section>
        <h2 className="font-semibold text-[#000643] text-lg">Who has access</h2>
        <p className="mt-1 text-gray-600 text-sm">
          Administrators can do everything, including pricing, refunds and access itself. A hostess works
          the welcome desk: today&apos;s schedule, checking exhibitors in, and starting a booking for
          someone at the counter. She never sees settings, pricing or refunds, and never handles a card.
        </p>

        <form
          className="mt-4 flex flex-wrap items-end gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            grant.mutate({ email, role });
          }}>
          <label className="min-w-[240px] flex-1">
            <span className="font-medium text-gray-700 text-sm">Account email</span>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="someone@vo-group.be"
              className={`mt-1 ${inputClass}`}
            />
          </label>
          <label>
            <span className="font-medium text-gray-700 text-sm">Role</span>
            <select
              value={role}
              onChange={(e) => setRole(e.target.value as "ADMIN" | "HOSTESS")}
              className={`mt-1 ${inputClass}`}>
              <option value="HOSTESS">Hostess</option>
              <option value="ADMIN">Administrator</option>
            </select>
          </label>
          <button
            type="submit"
            disabled={grant.isPending}
            className="inline-flex items-center gap-2 rounded-lg bg-[#000643] px-4 py-2 font-medium text-sm text-white transition hover:bg-[#000643]/90 disabled:opacity-50">
            <UserPlus className="h-4 w-4" aria-hidden />
            {grant.isPending ? "Granting…" : "Grant access"}
          </button>
        </form>
        <p className="mt-2 text-gray-500 text-xs">
          The person needs an account already — ask them to sign up first, then grant the role here.
        </p>

        {error ? (
          <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-red-700 text-sm">{error}</p>
        ) : null}

        <div className="mt-5 overflow-x-auto">
          <table className="w-full min-w-[560px] text-sm">
            <thead>
              <tr className="border-gray-200 border-b text-gray-500 text-xs uppercase tracking-wide">
                <th className="py-2 text-left font-medium">Account</th>
                <th className="py-2 text-left font-medium">Roles</th>
                <th className="py-2 text-left font-medium">Since</th>
                <th className="py-2 text-right font-medium">Remove</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {members.map((member) => (
                <tr key={member.userId}>
                  <td className="py-3">
                    <span className="block font-medium text-[#000643]">{member.name || member.email}</span>
                    {member.name ? (
                      <span className="block text-gray-500 text-xs">{member.email}</span>
                    ) : null}
                  </td>
                  <td className="py-3">
                    <span className="flex flex-wrap gap-1.5">
                      {member.calRole === "ADMIN" ? <RoleBadge role="ADMIN" /> : null}
                      {member.staffRole === "HOSTESS" ? <RoleBadge role="HOSTESS" /> : null}
                    </span>
                  </td>
                  <td className="py-3 text-gray-500">
                    {member.grantedAt ? when(String(member.grantedAt)) : "—"}
                  </td>
                  <td className="py-3 text-right">
                    <span className="inline-flex gap-1">
                      {member.calRole === "ADMIN" ? (
                        <button
                          type="button"
                          onClick={() => revoke.mutate({ userId: member.userId, role: "ADMIN" })}
                          className="rounded-md px-2 py-1 text-gray-500 text-xs transition hover:bg-red-50 hover:text-red-700">
                          Admin
                        </button>
                      ) : null}
                      {member.staffRole === "HOSTESS" ? (
                        <button
                          type="button"
                          onClick={() => revoke.mutate({ userId: member.userId, role: "HOSTESS" })}
                          aria-label={`Remove hostess access from ${member.email}`}
                          className="rounded-md px-2 py-1 text-gray-500 transition hover:bg-red-50 hover:text-red-700">
                          <Trash2 className="h-4 w-4" aria-hidden />
                        </button>
                      ) : null}
                    </span>
                  </td>
                </tr>
              ))}
              {!members.length && !staff.isPending ? (
                <tr>
                  <td colSpan={4} className="py-6 text-center text-gray-500">
                    No roles granted yet.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>

      <section>
        <h2 className="font-semibold text-[#000643] text-lg">Activity</h2>
        <p className="mt-1 text-gray-600 text-sm">
          What staff have done, most recent first. The welcome desk runs on a shared tablet, so this is
          the record of the action rather than of the account.
        </p>

        <ul className="mt-4 divide-y divide-gray-100">
          {actions.map((entry) => (
            <li key={entry.id} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 py-2.5 text-sm">
              <span className="w-28 shrink-0 text-gray-500 text-xs">{when(String(entry.createdAt))}</span>
              <span className="font-mono text-[#000643] text-xs">{entry.action}</span>
              <span className="min-w-0 flex-1 text-gray-700">{entry.detail}</span>
              <span className="text-gray-400 text-xs">{entry.actorEmail}</span>
            </li>
          ))}
          {!actions.length && !staff.isPending ? (
            <li className="py-6 text-center text-gray-500 text-sm">Nothing recorded yet.</li>
          ) : null}
        </ul>
      </section>
    </div>
  );
}
