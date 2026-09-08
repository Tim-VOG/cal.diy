"use client";

import { type Edit, link, prefixLines, wrap } from "@calcom/features/ne26-rooms/lib/markdownEdit";
import { Bold, Heading1, Heading2, Heading3, Italic, Link2, List, Underline } from "lucide-react";
import { useId, useLayoutEffect, useRef } from "react";

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
}: {
  value: string;
  onChange: (next: string) => void;
  rows?: number;
}): JSX.Element {
  const ref = useRef<HTMLTextAreaElement>(null);
  const pending = useRef<[number, number] | null>(null);
  const id = useId();

  /**
   * Put the selection back once React has written the new value.
   *
   * In a layout effect rather than a requestAnimationFrame: the frame callback
   * can run BEFORE the commit, and then setSelectionRange operates on the old
   * text and is immediately undone by the re-render. The symptom was subtle and
   * would have shipped — the first click formatted correctly, and only a second
   * click on the same word revealed that nothing was selected any more, so bold
   * could never be switched back off.
   */
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || !pending.current) return;
    const [start, end] = pending.current;
    pending.current = null;
    el.focus();
    el.setSelectionRange(start, end);
  });

  function run(tool: Tool): void {
    const el = ref.current;
    if (!el) return;
    const edit = tool.apply({ value: el.value, start: el.selectionStart, end: el.selectionEnd });
    pending.current = [edit.selectionStart, edit.selectionEnd];
    onChange(edit.text);
  }

  return (
    <div>
      <div
        className="flex flex-wrap items-center gap-0.5 rounded-t-lg border border-gray-200 border-b-0 bg-gray-50 px-1.5 py-1"
        role="toolbar"
        aria-label="Formatting"
        aria-controls={id}>
        {TOOLS.map((tool, i) => (
          <span key={tool.label} className="contents">
            {/* A rule before the headings and before the link, so eight icons
                read as three groups rather than one undifferentiated row. */}
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
      </div>
      <textarea
        id={id}
        ref={ref}
        rows={rows}
        className="w-full rounded-b-lg border border-gray-200 px-3 py-2 font-mono text-sm focus:border-[#000643] focus:outline-none"
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
      <p className="mt-1 text-gray-400 text-xs">
        Markdown. The buttons write it for you — ⌘B, ⌘I, ⌘U and ⌘K work too.
      </p>
    </div>
  );
}
