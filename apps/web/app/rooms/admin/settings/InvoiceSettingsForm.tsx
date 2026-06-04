"use client";

import type { InvoiceSettings } from "@calcom/features/ne26-rooms/repositories/InvoiceSettingsRepository";
import { trpc } from "@calcom/trpc/react";
import Link from "next/link";
import { useState } from "react";

const FIELDS: { key: keyof InvoiceSettings; label: string; full?: boolean; textarea?: boolean }[] = [
  { key: "legalName", label: "Legal name" },
  { key: "vatNumber", label: "VAT number" },
  { key: "addressLine1", label: "Address line 1", full: true },
  { key: "addressLine2", label: "Address line 2", full: true },
  { key: "postalCode", label: "Postal code" },
  { key: "city", label: "City" },
  { key: "country", label: "Country" },
  { key: "iban", label: "IBAN" },
  { key: "bic", label: "BIC" },
  { key: "contactEmail", label: "Contact email" },
  { key: "legalFooter", label: "Invoice footer / legal mentions", full: true, textarea: true },
];

const inputClass = "mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-[#000643] focus:outline-none";

export default function InvoiceSettingsForm({ initial }: { initial: InvoiceSettings }): JSX.Element {
  const [form, setForm] = useState<InvoiceSettings>(initial);
  const mutation = trpc.viewer.rooms.updateInvoiceSettings.useMutation();

  return (
    <div className="mx-auto max-w-2xl">
      <Link href="/rooms/admin" className="text-gray-500 text-sm hover:text-[#000643]">
        ← Back to admin
      </Link>
      <h1 className="mt-2 font-bold text-2xl text-[#000643]">Invoice / company settings</h1>
      <p className="mt-1 text-gray-600 text-sm">These details appear on every invoice and credit note.</p>

      <form
        className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2"
        onSubmit={(e) => {
          e.preventDefault();
          mutation.mutate(form);
        }}>
        {FIELDS.map((field) => (
          <label key={field.key} className={field.full ? "sm:col-span-2" : ""}>
            <span className="font-medium text-gray-700 text-sm">{field.label}</span>
            {field.textarea ? (
              <textarea
                rows={2}
                className={inputClass}
                value={form[field.key]}
                onChange={(e) => setForm((f) => ({ ...f, [field.key]: e.target.value }))}
              />
            ) : (
              <input
                type="text"
                className={inputClass}
                value={form[field.key]}
                onChange={(e) => setForm((f) => ({ ...f, [field.key]: e.target.value }))}
              />
            )}
          </label>
        ))}

        <div className="flex items-center gap-3 sm:col-span-2">
          <button
            type="submit"
            disabled={mutation.isPending}
            className="rounded-lg bg-[#000643] px-4 py-2.5 font-semibold text-sm text-white transition hover:opacity-90 disabled:opacity-40">
            {mutation.isPending ? "Saving…" : "Save settings"}
          </button>
          {mutation.isSuccess ? <span className="text-green-600 text-sm">Saved ✓</span> : null}
          {mutation.error ? <span className="text-red-600 text-sm">{mutation.error.message}</span> : null}
        </div>
      </form>
    </div>
  );
}
