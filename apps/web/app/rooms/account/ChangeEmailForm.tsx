"use client";

import { trpc } from "@calcom/trpc/react";
import { Pencil } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

const inputClass =
  "mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-[#000643] focus:outline-none";

/**
 * The address this exhibitor signs in with — a field of this form like any
 * other, reading as one.
 *
 * It sat in a panel of its own below the form, which made the one field that
 * decides whether they can still log in look like an afterthought. It is a
 * field now, at the top where identity belongs, and the pencil inside it is
 * what says it can be changed: the value stays read-only until it is pressed,
 * so nobody edits their login while reaching for their VAT number.
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

  const shown = saved ?? current;

  if (!open) {
    return (
      <div>
        <span className="font-medium text-gray-700 text-sm">Sign-in email</span>
        {/* A real field, greyed to say it is not typed into directly, with the
            pencil inside it rather than a button parked alongside. */}
        <div className="relative mt-1">
          <input
            type="email"
            readOnly
            aria-label="Sign-in email"
            value={shown}
            onClick={() => setOpen(true)}
            className="w-full cursor-pointer rounded-lg border border-gray-200 bg-gray-50 py-2 pr-10 pl-3 text-gray-700 text-sm"
          />
          <button
            type="button"
            aria-label="Change your sign-in email"
            onClick={() => {
              setEmail(shown);
              setSaved(null);
              setOpen(true);
            }}
            className="-translate-y-1/2 absolute top-1/2 right-2 rounded-md p-1.5 text-gray-400 transition hover:bg-gray-100 hover:text-[#000643]">
            <Pencil className="h-4 w-4" aria-hidden />
          </button>
        </div>
        {saved ? (
          <p role="status" className="mt-1.5 text-green-800 text-xs">
            Saved. Sign in with this address from now on — your password has not changed, and your bookings
            and invoices have moved with you.
          </p>
        ) : (
          <p className="mt-1.5 text-gray-500 text-xs">
            Where your invoices are sent, and the address you sign in with.
          </p>
        )}
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-[#000643]/30 bg-gray-50/60 p-3">
      <p className="font-medium text-gray-700 text-sm">Change your sign-in email</p>
      <p className="mt-0.5 text-gray-500 text-xs">
        You will sign in with the new address. Your password, bookings and invoices stay as they are.
      </p>
      {/* Its own form: this saves an identity, not the billing details below,
          and the two must never be submitted by one button. */}
      <form
        className="mt-3 grid gap-3 sm:grid-cols-2"
        onSubmit={(e) => {
          e.preventDefault();
          change.mutate({ email, password });
        }}>
        <label htmlFor="account-email" className="text-gray-600 text-xs">
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
        <label htmlFor="account-password" className="text-gray-600 text-xs">
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
            className="rounded-lg bg-[#000643] px-3.5 py-2 font-semibold text-sm text-white transition hover:opacity-90 disabled:opacity-40">
            {change.isPending ? "Saving…" : "Save new email"}
          </button>
          <button
            type="button"
            onClick={() => {
              setOpen(false);
              setPassword("");
            }}
            className="rounded-lg border border-gray-200 bg-white px-3.5 py-2 font-semibold text-gray-700 text-sm transition hover:border-gray-400">
            Cancel
          </button>
        </div>
      </form>
    </div>
  );
}
