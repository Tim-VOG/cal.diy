"use client";

import { trpc } from "@calcom/trpc/react";
import { useRouter } from "next/navigation";
import { useState } from "react";

const inputClass =
  "mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-[#000643] focus:outline-none";

/**
 * The address this exhibitor signs in with, and where their invoices go.
 *
 * Closed until they ask for it: most people come to this page for their billing
 * details, and an email field sitting open beside them invites an accidental
 * edit of the one field that decides whether they can still log in.
 *
 * The password is required because changing this address changes the login. It
 * is asked for here rather than trusted from the session, which on a shared
 * stand laptop is the difference between a correction and a takeover.
 */
export default function ChangeEmailForm({ current }: { current: string }): JSX.Element {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState(current);
  const [password, setPassword] = useState("");
  const [saved, setSaved] = useState<string | null>(null);

  const change = trpc.viewer.rooms.changeMyEmail.useMutation({
    onSuccess: (r) => {
      setSaved(r.email);
      setPassword("");
      setOpen(false);
      router.refresh();
    },
  });

  return (
    <section className="rounded-xl border border-gray-200 bg-white p-5">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="font-semibold text-[#000643] text-sm">Sign-in email</h2>
          <p className="mt-0.5 text-gray-600 text-sm">{saved ?? current}</p>
        </div>
        {open ? null : (
          <button
            type="button"
            onClick={() => {
              setEmail(saved ?? current);
              setSaved(null);
              setOpen(true);
            }}
            className="rounded-lg border border-gray-200 px-3 py-1.5 font-semibold text-[#000643] text-[13px] transition hover:border-[#000643]">
            Change
          </button>
        )}
      </div>

      {saved ? (
        <p role="status" className="mt-3 rounded-lg bg-green-50 px-3 py-2 text-green-800 text-xs">
          Saved. Sign in with {saved} from now on — your password has not changed, and your bookings and
          invoices have moved with you.
        </p>
      ) : null}

      {open ? (
        <form
          className="mt-4 grid gap-3 sm:grid-cols-2"
          onSubmit={(e) => {
            e.preventDefault();
            change.mutate({ email, password });
          }}>
          <label htmlFor="account-email" className="text-gray-600 text-xs sm:col-span-2">
            New email address
            <input
              id="account-email"
              type="email"
              required
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className={inputClass}
            />
          </label>
          <label htmlFor="account-password" className="text-gray-600 text-xs sm:col-span-2">
            Your password, to confirm it is you
            <input
              id="account-password"
              type="password"
              required
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className={inputClass}
            />
          </label>
          {change.error ? (
            <p role="alert" className="text-red-700 text-xs sm:col-span-2">
              {change.error.message}
            </p>
          ) : null}
          <div className="flex gap-2 sm:col-span-2">
            <button
              type="submit"
              disabled={change.isPending}
              className="rounded-lg bg-[#000643] px-4 py-2 font-semibold text-sm text-white transition hover:opacity-90 disabled:opacity-40">
              {change.isPending ? "Saving…" : "Save new email"}
            </button>
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                setPassword("");
              }}
              className="rounded-lg border border-gray-200 px-4 py-2 font-semibold text-gray-700 text-sm transition hover:border-gray-400">
              Cancel
            </button>
          </div>
        </form>
      ) : null}
    </section>
  );
}
