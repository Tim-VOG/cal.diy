"use client";

import { COUNTRY_OPTIONS } from "@calcom/features/ne26-rooms/lib/countries";
import type { BillingProfile } from "@calcom/features/ne26-rooms/repositories/Ne26BillingProfileRepository";
import { trpc } from "@calcom/trpc/react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

type TextFieldKey = "firstName" | "lastName" | "vatNumber";

/**
 * Only what has to be known before the buyer reaches Stripe.
 *
 * This was ten fields, and it stood between an exhibitor and the room list. The
 * company name, street, postcode and city are now collected by Checkout, which
 * was always going to ask for an address anyway; the purchase order number and
 * the internal reference are asked for there too, as optional custom fields,
 * because they belong to an order rather than to a person.
 *
 * What is left cannot be moved. The country decides the VAT and the VAT decides
 * the amount charged, so it has to be settled while the price is still being
 * computed. The contact name is who the welcome desk asks for at the door.
 *
 * `optional` mirrors isBillingProfileComplete(): anything not marked optional is
 * required there, so the browser refuses the submit rather than letting someone
 * save, get bounced back by the guard, and have to guess what was missing.
 */
const TEXT_FIELDS: {
  key: TextFieldKey;
  label: string;
  full?: boolean;
  optional?: boolean;
  autoComplete: string;
}[] = [
  // The welcome desk asks for a person, not a company.
  { key: "firstName", label: "First name", autoComplete: "given-name" },
  { key: "lastName", label: "Last name", autoComplete: "family-name" },
  { key: "vatNumber", label: "VAT number", full: true, optional: true, autoComplete: "off" },
];

const EMPTY: BillingProfile = {
  firstName: "",
  lastName: "",
  legalName: "",
  vatNumber: "",
  poNumber: "",
  internalReference: "",
  country: "",
  addressLine1: "",
  addressLine2: "",
  postalCode: "",
  city: "",
};

const inputClass =
  "mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-[#000643] focus:outline-none";

export default function BillingProfileForm({
  initial,
  next,
}: {
  initial: BillingProfile | null;
  /** Where the exhibitor was heading when we asked them to complete this. */
  next?: string | null;
}): JSX.Element {
  const router = useRouter();
  const [form, setForm] = useState<BillingProfile>(initial ?? EMPTY);
  const mutation = trpc.viewer.rooms.updateBillingProfile.useMutation({
    onSuccess: () => {
      // Return them to what they were doing rather than leaving them on a form
      // they were pushed onto.
      if (next) router.push(next);
      else router.refresh();
    },
  });

  return (
    <div className="mx-auto max-w-2xl">
      {/* Shown when they were redirected here rather than arriving on purpose. */}
      {next ? (
        <div className="mb-4 rounded-xl border border-amber-300 bg-amber-50 p-4" role="status">
          <p className="font-semibold text-[#000643] text-sm">Complete your billing details to continue</p>
          <p className="mt-1 text-gray-700 text-sm">
            Three fields: they set the VAT on your invoice and tell the welcome desk who to expect.
            We&apos;ll take you straight back once saved.
          </p>
        </div>
      ) : null}
      <Link href="/rooms" className="text-gray-500 text-sm hover:text-[#000643]">
        ← Back to rooms
      </Link>
      <h1 className="mt-2 font-bold text-2xl text-[#000643]">Billing details</h1>
      <p className="mt-1 text-gray-600 text-sm">
        Just enough to price your booking correctly and to greet you at the desk. Your country and VAT number
        determine how VAT is applied. Your invoice address is collected on the payment page.
      </p>

      <form
        className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2"
        onSubmit={(e) => {
          e.preventDefault();
          mutation.mutate(form);
        }}>
        {TEXT_FIELDS.map((field) => (
          <label key={field.key} className={field.full ? "sm:col-span-2" : ""}>
            <span className="font-medium text-gray-700 text-sm">
              {field.label}
              {field.optional ? <span className="ml-1 text-gray-400">(optional)</span> : null}
            </span>
            <input
              type="text"
              autoComplete={field.autoComplete}
              required={!field.optional}
              className={inputClass}
              value={form[field.key]}
              onChange={(e) => setForm((f) => ({ ...f, [field.key]: e.target.value }))}
            />
          </label>
        ))}

        <label>
          <span className="font-medium text-gray-700 text-sm">Country</span>
          <select
            required
            autoComplete="country"
            className={inputClass}
            value={form.country}
            onChange={(e) => setForm((f) => ({ ...f, country: e.target.value }))}>
            <option value="">Select a country…</option>
            {COUNTRY_OPTIONS.map((c) => (
              <option key={c.code} value={c.code}>
                {c.name}
              </option>
            ))}
          </select>
        </label>

        <div className="flex items-center gap-3 sm:col-span-2">
          <button
            type="submit"
            disabled={mutation.isPending}
            className="rounded-lg bg-[#000643] px-4 py-2.5 font-semibold text-sm text-white transition hover:opacity-90 disabled:opacity-40">
            {mutation.isPending ? "Saving…" : "Save billing details"}
          </button>
          {mutation.isSuccess ? <span className="text-green-600 text-sm">Saved ✓</span> : null}
          {mutation.error ? <span className="text-red-600 text-sm">{mutation.error.message}</span> : null}
        </div>
      </form>
    </div>
  );
}
