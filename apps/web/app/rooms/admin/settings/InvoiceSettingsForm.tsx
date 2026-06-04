"use client";

import type { InvoiceSettings } from "@calcom/features/ne26-rooms/repositories/InvoiceSettingsRepository";
import { trpc } from "@calcom/trpc/react";
import Link from "next/link";
import { useState } from "react";

type StringSettingKey =
  | "legalName"
  | "vatNumber"
  | "addressLine1"
  | "addressLine2"
  | "postalCode"
  | "city"
  | "country"
  | "iban"
  | "bic"
  | "contactEmail";

const FIELDS: { key: StringSettingKey; label: string; full?: boolean; textarea?: boolean }[] = [
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
];

type FooterColumnKey = "footerColumn1" | "footerColumn2" | "footerColumn3";
const FOOTER_COLUMNS: { key: FooterColumnKey; label: string }[] = [
  { key: "footerColumn1", label: "Column 1" },
  { key: "footerColumn2", label: "Column 2" },
  { key: "footerColumn3", label: "Column 3" },
];

const inputClass =
  "mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-[#000643] focus:outline-none";

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

        {/* VAT-by-country matrix */}
        <div className="mt-2 border-gray-100 border-t pt-4 sm:col-span-2">
          <h2 className="font-semibold text-[#000643] text-sm uppercase tracking-wide">VAT by country</h2>
          <p className="mt-1 text-gray-500 text-xs">
            Belgian buyers always get standard Belgian VAT. Enable the rules below only if your accountant
            confirms they apply (mind the place-of-supply rules for room rental at a Belgian event).
          </p>

          <label className="mt-3 flex items-center gap-2">
            <input
              type="checkbox"
              checked={form.euReverseChargeEnabled}
              onChange={(e) => setForm((f) => ({ ...f, euReverseChargeEnabled: e.target.checked }))}
              className="h-4 w-4 accent-[#000643]"
            />
            <span className="font-medium text-sm">
              EU reverse charge (buyer in another EU country with a VAT number)
            </span>
          </label>
          <input
            type="text"
            className={inputClass}
            value={form.euReverseChargeMention}
            onChange={(e) => setForm((f) => ({ ...f, euReverseChargeMention: e.target.value }))}
            placeholder="Legal mention printed on the invoice"
          />

          <label className="mt-4 flex items-center gap-2">
            <input
              type="checkbox"
              checked={form.nonEuExemptEnabled}
              onChange={(e) => setForm((f) => ({ ...f, nonEuExemptEnabled: e.target.checked }))}
              className="h-4 w-4 accent-[#000643]"
            />
            <span className="font-medium text-sm">Non-EU exemption (buyer outside the EU)</span>
          </label>
          <input
            type="text"
            className={inputClass}
            value={form.nonEuExemptMention}
            onChange={(e) => setForm((f) => ({ ...f, nonEuExemptMention: e.target.value }))}
            placeholder="Legal mention printed on the invoice"
          />
        </div>

        {/* Invoice footer — three columns, each multi-line (one line break = one row). */}
        <div className="mt-2 border-gray-100 border-t pt-4 sm:col-span-2">
          <h2 className="font-semibold text-[#000643] text-sm uppercase tracking-wide">
            Invoice footer (3 columns)
          </h2>
          <p className="mt-1 text-gray-500 text-xs">
            Printed as three columns at the bottom of invoices and credit notes. Use line breaks to lay each
            block out across multiple rows.
          </p>
          <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
            {FOOTER_COLUMNS.map((col) => (
              <label key={col.key}>
                <span className="font-medium text-gray-700 text-sm">{col.label}</span>
                <textarea
                  rows={5}
                  className={inputClass}
                  value={form[col.key]}
                  onChange={(e) => setForm((f) => ({ ...f, [col.key]: e.target.value }))}
                />
              </label>
            ))}
          </div>
        </div>

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
