"use client";

import { type Edit, link, prefixLines, wrap } from "@calcom/features/ne26-rooms/lib/markdownEdit";
import {
  Bold,
  Heading1,
  Heading2,
  Heading3,
  Italic,
  Link2,
  List,
  Maximize2,
  Minimize2,
  Underline,
} from "lucide-react";
import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";

/**
 * A textarea with the formatting tools, over Markdown.
 *
 * Markdown rather than a WYSIWYG on purpose. The column already holds Markdown,
 * markdownToSafeHTML already renders and sanitises it, and every button below
 * maps to something that pipeline already supports — so this adds no dependency
 * and moves an admin-authored string no closer to the page than it already was.
 *
 * What the buttons do lives in lib/markdownEdit, which is tested; what is here
 * is the wiring, which is not worth testing and would be tedious to.
 */

interface Tool {
  label: string;
  Icon: typeof Bold;
  /** Ctrl/Cmd shortcut, where there is a conventional one. */
  key?: string;
  apply: (sel: { value: string; start: number; end: number }) => Edit;
}

const TOOLS: Tool[] = [
  { label: "Bold", Icon: Bold, key: "b", apply: (s) => wrap(s, "**") },
  { label: "Italic", Icon: Italic, key: "i", apply: (s) => wrap(s, "*") },
  // Markdown has no underline; the HTML tag survives markdown-it (html: true)
  // and sanitize-html's defaults. Checked before this button was drawn.
  { label: "Underline", Icon: Underline, key: "u", apply: (s) => wrap(s, "<u>", "</u>") },
  { label: "Heading 1", Icon: Heading1, apply: (s) => prefixLines(s, "# ") },
  { label: "Heading 2", Icon: Heading2, apply: (s) => prefixLines(s, "## ") },
  { label: "Heading 3", Icon: Heading3, apply: (s) => prefixLines(s, "### ") },
  { label: "Bullet list", Icon: List, apply: (s) => prefixLines(s, "- ") },
  { label: "Link", Icon: Link2, key: "k", apply: (s) => link(s) },
];

export default function MarkdownField({
  value,
  onChange,
  rows = 12,
  title,
  onSave,
  saving = false,
}: {
  value: string;
  onChange: (next: string) => void;
  rows?: number;
  /** Named in the full-screen header, so it is clear which page is open. */
  title?: string;
  /** Offered inside full screen: leaving to reach Save would defeat the point. */
  onSave?: () => void;
  saving?: boolean;
}): JSX.Element {
  const ref = useRef<HTMLTextAreaElement>(null);
  const pending = useRef<{ start: number; end: number; scrollTop: number } | null>(null);
  const [expanded, setExpanded] = useState(false);
  const id = useId();

  /**
   * Put the selection and the scroll position back once React has written the
   * new value.
   *
   * In a layout effect rather than a requestAnimationFrame: the frame callback
   * can run BEFORE the commit, and then setSelectionRange operates on the old
   * text and is immediately undone by the re-render. The first click looked
   * right and only a second click on the same word revealed that nothing was
   * selected any more, so bold could never be switched back off.
   *
   * The scroll matters just as much. Writing `value` on a textarea resets its
   * scroll, so formatting a line halfway down a long page threw the writer to
   * the bottom of the document and left them to find their way back.
   */
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || !pending.current) return;
    const { start, end, scrollTop } = pending.current;
    pending.current = null;
    el.focus();
    el.setSelectionRange(start, end);
    el.scrollTop = scrollTop;
  });

  // Escape leaves full screen, and the page behind it does not scroll while it
  // is open.
  useEffect(() => {
    if (!expanded) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setExpanded(false);
    };
    document.addEventListener("keydown", onKey);
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = previous;
    };
  }, [expanded]);

  function run(tool: Tool): void {
    const el = ref.current;
    if (!el) return;
    const edit = tool.apply({ value: el.value, start: el.selectionStart, end: el.selectionEnd });
    pending.current = { start: edit.selectionStart, end: edit.selectionEnd, scrollTop: el.scrollTop };
    onChange(edit.text);
  }

  const toolbar = (
    <div
      className="flex flex-wrap items-center gap-0.5 border-gray-200 border-b bg-gray-50 px-1.5 py-1"
      role="toolbar"
      aria-label="Formatting"
      aria-controls={id}>
      {TOOLS.map((tool, i) => (
        <span key={tool.label} className="contents">
          {/* A rule before the headings and before the link, so eight icons read
              as three groups rather than one undifferentiated row. */}
          {i === 3 || i === 6 ? <span className="mx-1 h-4 w-px bg-gray-200" aria-hidden /> : null}
          <button
            type="button"
            title={tool.key ? `${tool.label} (⌘${tool.key.toUpperCase()})` : tool.label}
            aria-label={tool.label}
            onClick={() => run(tool)}
            className="rounded p-1.5 text-gray-600 transition hover:bg-white hover:text-[#000643]">
            <tool.Icon className="h-4 w-4" aria-hidden />
          </button>
        </span>
      ))}
      <button
        type="button"
        title={expanded ? "Close full screen (Esc)" : "Edit full screen"}
        aria-label={expanded ? "Close full screen" : "Edit full screen"}
        onClick={() => setExpanded((v) => !v)}
        className="ml-auto rounded p-1.5 text-gray-600 transition hover:bg-white hover:text-[#000643]">
        {expanded ? <Minimize2 className="h-4 w-4" aria-hidden /> : <Maximize2 className="h-4 w-4" aria-hidden />}
      </button>
    </div>
  );

  const textarea = (
    <textarea
      id={id}
      ref={ref}
      rows={expanded ? undefined : rows}
      className={`w-full resize-none border-0 px-3 py-2 font-mono text-sm focus:outline-none ${
        expanded ? "min-h-0 flex-1 px-6 py-4 text-base leading-relaxed" : ""
      }`}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      onKeyDown={(e) => {
        if (!(e.metaKey || e.ctrlKey) || e.altKey) return;
        const tool = TOOLS.find((t) => t.key === e.key.toLowerCase());
        if (!tool) return;
        // Only once it is certain this is ours: swallowing an unrelated
        // shortcut is worse than not having one.
        e.preventDefault();
        run(tool);
      }}
    />
  );

  if (expanded) {
    return (
      <div className="fixed inset-0 z-50 flex flex-col bg-white" role="dialog" aria-modal="true">
        <div className="flex items-center gap-3 border-gray-200 border-b px-6 py-3">
          <h2 className="font-semibold text-[#000643]">{title || "Page content"}</h2>
          <div className="ml-auto flex items-center gap-2">
            {onSave ? (
              <button
                type="button"
                onClick={onSave}
                disabled={saving}
                className="rounded-lg bg-[#000643] px-4 py-2 font-semibold text-sm text-white transition hover:opacity-90 disabled:opacity-40">
                {saving ? "Saving…" : "Save"}
              </button>
            ) : null}
            <button
              type="button"
              onClick={() => setExpanded(false)}
              className="rounded-lg border border-gray-200 px-4 py-2 font-medium text-gray-700 text-sm transition hover:border-gray-400">
              Done
            </button>
          </div>
        </div>
        {toolbar}
        {textarea}
        <p className="border-gray-100 border-t px-6 py-2 text-gray-400 text-xs">
          Markdown — ⌘B, ⌘I, ⌘U and ⌘K. Esc closes this.
        </p>
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-lg border border-gray-200 focus-within:border-[#000643]">
      {toolbar}
      {textarea}
    </div>
  );
}
