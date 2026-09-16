"use client";

import { trpc } from "@calcom/trpc/react";
import { Pencil } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

export interface BillToValues {
  companyName: string;
  firstName: string;
  lastName: string;
  addressLine1: string;
  addressLine2: string;
  postalCode: string;
  city: string;
  region: string;
}

const FIELDS: { key: keyof BillToValues; label: string; wide?: boolean; autoComplete: string }[] = [
  { key: "companyName", label: "Company name", wide: true, autoComplete: "organization" },
  { key: "firstName", label: "Contact first name", autoComplete: "given-name" },
  { key: "lastName", label: "Contact last name", autoComplete: "family-name" },
  { key: "addressLine1", label: "Address", wide: true, autoComplete: "address-line1" },
  { key: "addressLine2", label: "Address line 2", wide: true, autoComplete: "address-line2" },
  { key: "postalCode", label: "Postal code", autoComplete: "postal-code" },
  { key: "city", label: "City", autoComplete: "address-level2" },
  { key: "region", label: "Region", wide: true, autoComplete: "address-level1" },
];

const btn =
  "inline-flex items-center justify-center gap-1.5 rounded-lg px-3 py-1.5 font-semibold text-[13px] transition disabled:opacity-40";

/**
 * The order's "Bill to", and the one place an admin can correct it.
 *
 * Only who the documents are made out to can change here. Country and VAT
 * number are shown but locked: they decided the VAT that was charged.
 */
export default function BillToEditor({
  uid,
  values,
  country,
  vatNumber,
  hasInvoice,
  hasCreditNote,
  correctedAt,
}: {
  uid: string;
  values: BillToValues;
  country: string | null;
  vatNumber: string | null;
  hasInvoice: boolean;
  hasCreditNote: boolean;
  /** Already formatted, e.g. "17 Sept, 10:42". */
  correctedAt: string | null;
}): JSX.Element {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState<BillToValues>(values);
  const [emailBuyer, setEmailBuyer] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const correct = trpc.viewer.rooms.correctBilling.useMutation({
    onSuccess: (r) => {
      setEditing(false);
      const docs = r.regenerated.map((k) => (k === "invoice" ? "invoice" : "credit note")).join(" and ");
      setNotice(
        !r.changed
          ? "Nothing changed."
          : docs
            ? `Saved. The ${docs} ${r.regenerated.length > 1 ? "were" : "was"} updated under the same number${r.emailed ? ", and the invoice was emailed to the buyer" : ""}.`
            : "Saved. The invoice will use these details when it is issued."
      );
      router.refresh();
    },
  });

  const contact = [values.firstName, values.lastName].filter(Boolean).join(" ");
  const lines = [
    values.companyName,
    values.companyName && contact !== values.companyName ? contact : "",
    [values.addressLine1, values.addressLine2].filter(Boolean).join(", "),
    [values.postalCode, values.city].filter(Boolean).join(" "),
    values.region,
    country,
    vatNumber ? `VAT ${vatNumber}` : "",
  ].filter(Boolean);
  if (!values.companyName && contact) lines.unshift(contact);

  const documents = [hasInvoice ? "invoice" : "", hasCreditNote ? "credit note" : ""].filter(Boolean);

  if (!editing) {
    return (
      <section className="rounded-xl border border-gray-200 bg-white p-4">
        <div className="flex items-center justify-between gap-2">
          <h2 className="font-semibold text-[11px] text-gray-500 uppercase tracking-[0.07em]">Bill to</h2>
          <button
            type="button"
            onClick={() => {
              setForm(values);
              setNotice(null);
              setEditing(true);
            }}
            className={`${btn} -my-1 text-[#000643] hover:bg-gray-100`}>
            <Pencil className="h-3.5 w-3.5" aria-hidden />
            Correct
          </button>
        </div>
        {lines.length === 0 ? (
          <p className="mt-2 text-gray-400 text-sm">Nothing was collected at checkout.</p>
        ) : (
          <p className="mt-2 whitespace-pre-line text-gray-900 text-sm leading-relaxed">{lines.join("\n")}</p>
        )}
        {correctedAt ? (
          <p className="mt-2 text-gray-500 text-xs">Corrected by an admin · {correctedAt}</p>
        ) : null}
        {notice ? (
          <p role="status" className="mt-2 rounded-lg bg-green-50 px-3 py-2 text-green-800 text-xs">
            {notice}
          </p>
        ) : null}
      </section>
    );
  }

  const input =
    "mt-1 w-full rounded-lg border border-gray-200 bg-white px-2.5 py-1.5 text-[13px] focus:border-[#000643] focus:outline-none";

  return (
    <section className="rounded-xl border border-[#000643]/40 bg-white p-4">
      <h2 className="font-semibold text-[11px] text-gray-500 uppercase tracking-[0.07em]">Correct bill to</h2>
      <p className="mt-1 text-gray-600 text-xs">
        {documents.length
          ? `The ${documents.join(" and ")} will be updated under the same number and date. Rooms, amounts and VAT do not change.`
          : "No invoice has been issued yet; it will use these details. Rooms, amounts and VAT do not change."}
      </p>
      <form
        className="mt-3 grid gap-x-3 gap-y-2.5 sm:grid-cols-2"
        onSubmit={(e) => {
          e.preventDefault();
          correct.mutate({ uid, ...form, emailBuyer: hasInvoice && emailBuyer });
        }}>
        {FIELDS.map((f) => (
          <label
            key={f.key}
            htmlFor={`billto-${f.key}`}
            className={`text-gray-600 text-xs ${f.wide ? "sm:col-span-2" : ""}`}>
            {f.label}
            <input
              id={`billto-${f.key}`}
              value={form[f.key]}
              autoComplete={f.autoComplete}
              onChange={(e) => setForm((prev) => ({ ...prev, [f.key]: e.target.value }))}
              className={input}
            />
          </label>
        ))}
        <p className="text-gray-500 text-xs sm:col-span-2">
          Country {country || "—"} · VAT {vatNumber || "—"} — locked: they set the VAT that was charged.
        </p>
        {hasInvoice ? (
          <label
            htmlFor="billto-email"
            className="flex items-center gap-2 text-[13px] text-gray-700 sm:col-span-2">
            <input
              id="billto-email"
              type="checkbox"
              checked={emailBuyer}
              onChange={(e) => setEmailBuyer(e.target.checked)}
            />
            Email the corrected invoice to the buyer
          </label>
        ) : null}
        {correct.error ? (
          <p role="alert" className="text-red-600 text-xs sm:col-span-2">
            {correct.error.message}
          </p>
        ) : null}
        <div className="flex gap-2 sm:col-span-2">
          <button
            type="submit"
            disabled={correct.isPending}
            className={`${btn} bg-[#000643] text-white hover:opacity-90`}>
            {correct.isPending ? "Saving…" : "Save correction"}
          </button>
          <button
            type="button"
            onClick={() => setEditing(false)}
            disabled={correct.isPending}
            className={`${btn} border border-gray-200 bg-white text-gray-700 hover:border-gray-400`}>
            Cancel
          </button>
        </div>
      </form>
    </section>
  );
}
