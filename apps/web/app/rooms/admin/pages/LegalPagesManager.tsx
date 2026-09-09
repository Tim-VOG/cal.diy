"use client";

import { trpc } from "@calcom/trpc/react";
import MarkdownField from "./MarkdownField";
import { useRouter } from "next/navigation";
import { useState } from "react";

export interface LegalPageRow {
  id: number;
  slug: string;
  title: string;
  content: string;
  externalUrl: string;
  published: boolean;
}

const input =
  "mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-[#000643] focus:outline-none";
const label = "block font-medium text-gray-500 text-xs";

export default function LegalPagesManager({ pages }: { pages: LegalPageRow[] }): JSX.Element {
  const router = useRouter();
  const [draft, setDraft] = useState<LegalPageRow[]>(pages);
  const [savingId, setSavingId] = useState<number | null>(null);
  const refreshOnly = { onSuccess: () => router.refresh() };
  const update = trpc.viewer.rooms.updateLegalPage.useMutation({
    onSettled: () => setSavingId(null),
    onSuccess: () => router.refresh(),
  });
  const remove = trpc.viewer.rooms.deleteLegalPage.useMutation(refreshOnly);
  const create = trpc.viewer.rooms.createLegalPage.useMutation({
    onSuccess: () => {
      setNewTitle("");
      setNewSlug("");
      router.refresh();
    },
  });

  const [newTitle, setNewTitle] = useState("");
  const [newSlug, setNewSlug] = useState("");

  function setField(id: number, field: keyof LegalPageRow, value: string | boolean): void {
    setDraft((rows) => rows.map((r) => (r.id === id ? { ...r, [field]: value } : r)));
  }

  function save(row: LegalPageRow): void {
    setSavingId(row.id);
    update.mutate({
      id: row.id,
      slug: row.slug,
      title: row.title,
      content: row.content,
      externalUrl: row.externalUrl.trim(),
      published: row.published,
    });
  }

  const error = update.error ?? remove.error ?? create.error;

  return (
    <div>
      <h1 className="font-bold text-2xl text-[#000643]">Pages</h1>
      <p className="mt-1 text-gray-600 text-sm">
        Legal &amp; informational pages, rendered publicly at <code>/rooms/legal/[slug]</code>. Use the
        toolbar to format; the ⤢ button opens the editor full screen. Unpublished pages return 404.
      </p>

      {/* Create */}
      <div className="mt-5 rounded-xl border border-gray-200 bg-white p-5">
        <h2 className="font-semibold text-[#000643] text-xs uppercase tracking-wide">New page</h2>
        <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
          <label>
            <span className={label}>Title</span>
            <input
              type="text"
              className={input}
              value={newTitle}
              onChange={(e) => setNewTitle(e.target.value)}
            />
          </label>
          <label>
            <span className={label}>Slug (URL)</span>
            <input
              type="text"
              placeholder="privacy-policy"
              className={input}
              value={newSlug}
              onChange={(e) => setNewSlug(e.target.value)}
            />
          </label>
        </div>
        <button
          type="button"
          disabled={!newTitle.trim() || !newSlug.trim() || create.isPending}
          onClick={() => create.mutate({ title: newTitle.trim(), slug: newSlug.trim() })}
          className="mt-3 rounded-lg bg-[#000643] px-4 py-2 font-semibold text-sm text-white transition hover:opacity-90 disabled:opacity-40">
          {create.isPending ? "Creating…" : "Create page"}
        </button>
      </div>

      {/* Page editors */}
      {/* One column, not two. Side by side, each editor got half the screen for
          a page of prose — which is what "edit it full screen" was asking to
          escape. The button in the toolbar goes further when that is needed. */}
      <div className="mt-6 grid grid-cols-1 items-start gap-4">
        {draft.map((r) => (
          <div key={r.id} className="@container rounded-xl border border-gray-200 bg-white p-5">
            <div className="grid grid-cols-1 gap-3 @lg:grid-cols-2">
              <label>
                <span className={label}>Title</span>
                <input
                  type="text"
                  className={input}
                  value={r.title}
                  onChange={(e) => setField(r.id, "title", e.target.value)}
                />
              </label>
              <label>
                <span className={label}>Slug (URL)</span>
                <input
                  type="text"
                  className={input}
                  value={r.slug}
                  onChange={(e) => setField(r.id, "slug", e.target.value)}
                />
              </label>
            </div>

            <label className="mt-3 block">
              <span className={label}>Link to a document instead (optional)</span>
              <input
                type="url"
                inputMode="url"
                placeholder="https://…/brochure.pdf"
                className={input}
                value={r.externalUrl}
                onChange={(e) => setField(r.id, "externalUrl", e.target.value)}
              />
            </label>

            {/* Said where the decision is made, not in a help page: with a link
                set, whatever is written below is never shown to anybody. */}
            {r.externalUrl.trim() ? (
              <p className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-amber-800 text-xs">
                This page redirects to the link above. The content below is kept but not shown — clear the
                link to publish it again.
              </p>
            ) : null}

            <div className={`mt-3 ${r.externalUrl.trim() ? "opacity-50" : ""}`}>
              <span className={label}>Content</span>
              <div className="mt-1">
                <MarkdownField
                  value={r.content}
                  onChange={(next) => setField(r.id, "content", next)}
                  title={r.title}
                  onSave={() => save(r)}
                  saving={savingId === r.id}
                />
              </div>
            </div>

            <div className="mt-4 flex flex-wrap items-center gap-4">
              <label className="flex items-center gap-2 text-gray-700 text-sm">
                <input
                  type="checkbox"
                  checked={r.published}
                  onChange={(e) => setField(r.id, "published", e.target.checked)}
                  className="h-4 w-4 accent-[#000643]"
                />
                Published
              </label>
              <a
                href={`/rooms/legal/${r.slug}`}
                target="_blank"
                rel="noreferrer"
                className="text-[#000643] text-sm underline hover:opacity-80">
                View page →
              </a>
              <div className="ml-auto flex gap-2">
                <button
                  type="button"
                  onClick={() => save(r)}
                  disabled={savingId === r.id}
                  className="rounded-lg bg-[#000643] px-4 py-2 font-semibold text-sm text-white transition hover:opacity-90 disabled:opacity-40">
                  {savingId === r.id ? "Saving…" : "Save"}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    if (window.confirm(`Delete "${r.title}"?`)) remove.mutate({ id: r.id });
                  }}
                  className="rounded-lg border border-red-200 px-3 py-2 font-medium text-red-600 text-sm transition hover:border-red-400">
                  Delete
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>

      {error ? <p className="mt-3 text-red-600 text-sm">{error.message}</p> : null}
    </div>
  );
}
