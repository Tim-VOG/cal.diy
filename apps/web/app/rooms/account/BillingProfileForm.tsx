"use client";

import { COUNTRY_OPTIONS } from "@calcom/features/ne26-rooms/lib/countries";
import type { BillingProfile } from "@calcom/features/ne26-rooms/repositories/Ne26BillingProfileRepository";
import { trpc } from "@calcom/trpc/react";
import Link from "next/link";
import { useState } from "react";

type TextFieldKey = "legalName" | "vatNumber" | "addressLine1" | "addressLine2" | "postalCode" | "city";

const TEXT_FIELDS: { key: TextFieldKey; label: string; full?: boolean }[] = [
  { key: "legalName", label: "Company / legal name", full: true },
  { key: "vatNumber", label: "VAT number" },
  { key: "addressLine1", label: "Address line 1", full: true },
  { key: "addressLine2", label: "Address line 2", full: true },
  { key: "postalCode", label: "Postal code" },
  { key: "city", label: "City" },
];

const EMPTY: BillingProfile = {
  legalName: "",
  vatNumber: "",
  country: "",
  addressLine1: "",
  addressLine2: "",
  postalCode: "",
  city: "",
};

const inputClass =
  "mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-[#000643] focus:outline-none";

export default function BillingProfileForm({ initial }: { initial: BillingProfile | null }): JSX.Element {
  const [form, setForm] = useState<BillingProfile>(initial ?? EMPTY);
  const mutation = trpc.viewer.rooms.updateBillingProfile.useMutation();

  return (
    <div className="mx-auto max-w-2xl">
      <Link href="/rooms" className="text-gray-500 text-sm hover:text-[#000643]">
        ← Back to rooms
      </Link>
      <h1 className="mt-2 font-bold text-2xl text-[#000643]">Billing details</h1>
      <p className="mt-1 text-gray-600 text-sm">
        Saved once and reused at checkout, so you don&apos;t re-enter them every booking. Your VAT number and
        country determine how VAT is applied on your invoice.
      </p>

      <form
        className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2"
        onSubmit={(e) => {
          e.preventDefault();
          mutation.mutate(form);
        }}>
        {TEXT_FIELDS.map((field) => (
          <label key={field.key} className={field.full ? "sm:col-span-2" : ""}>
            <span className="font-medium text-gray-700 text-sm">{field.label}</span>
            <input
              type="text"
              className={inputClass}
              value={form[field.key]}
              onChange={(e) => setForm((f) => ({ ...f, [field.key]: e.target.value }))}
            />
          </label>
        ))}

        <label>
          <span className="font-medium text-gray-700 text-sm">Country</span>
          <select
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
