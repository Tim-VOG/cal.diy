import { describe, expect, it } from "vitest";
import { type Selection, link, prefixLines, wrap } from "./markdownEdit";

/** "abc[def]ghi" — the brackets mark the selection. */
function sel(marked: string): Selection {
  const start = marked.indexOf("[");
  const end = marked.indexOf("]") - 1;
  return { value: marked.replace(/[[\]]/g, ""), start, end };
}

/** Render an edit back into the same notation, so the caret is visible too. */
function show(edit: { text: string; selectionStart: number; selectionEnd: number }): string {
  const { text, selectionStart: s, selectionEnd: e } = edit;
  return `${text.slice(0, s)}[${text.slice(s, e)}]${text.slice(e)}`;
}

describe("wrap", () => {
  it("wraps the selection and keeps it selected", () => {
    // Selected text stays selected, so a second button applies to the same
    // words instead of to nothing.
    expect(show(wrap(sel("make [this] bold"), "**"))).toBe("make **[this]** bold");
  });

  it("unwraps when the markers are already around the selection", () => {
    // Clicking bold twice gives back plain text, not ****this****.
    expect(show(wrap(sel("make **[this]** bold"), "**"))).toBe("make [this] bold");
  });

  it("unwraps when the markers are inside the selection", () => {
    // Same intent, different way of selecting it: the buyer dragged across the
    // asterisks rather than between them.
    expect(show(wrap(sel("make [**this**] bold"), "**"))).toBe("make [this] bold");
  });

  it("inserts empty markers with the caret between them when nothing is selected", () => {
    expect(show(wrap(sel("type []here"), "*"))).toBe("type *[]*here");
  });

  it("uses an HTML tag for underline, which Markdown has no syntax for", () => {
    expect(show(wrap(sel("[stress] this"), "<u>", "</u>"))).toBe("<u>[stress]</u> this");
    expect(show(wrap(sel("<u>[stress]</u> this"), "<u>", "</u>"))).toBe("[stress] this");
  });

  it("does not mistake a shorter selection for a wrapped one", () => {
    // "*" selected on its own must not be read as an empty italic pair and
    // silently deleted.
    expect(show(wrap(sel("a [*] b"), "*"))).toBe("a *[*]* b");
  });
});

describe("prefixLines", () => {
  it("puts a heading on the line the caret is in", () => {
    expect(show(prefixLines(sel("Terms[] of sale"), "## "))).toBe("[## Terms of sale]");
  });

  it("replaces a heading rather than stacking on it", () => {
    // H2 then H3 on the same line is a level change, not "### ## ".
    expect(show(prefixLines(sel("## Terms[] of sale"), "### "))).toBe("[### Terms of sale]");
  });

  it("takes the heading off when it is already that level", () => {
    expect(show(prefixLines(sel("## Terms[] of sale"), "## "))).toBe("[Terms of sale]");
  });

  it("bullets every line the selection touches, and no others", () => {
    // The selection starts inside line two, so line one is none of its
    // business — a toolbar that reformats text the writer did not select is a
    // toolbar they stop trusting.
    expect(prefixLines(sel("one\ntw[o\nthr]ee"), "- ").text).toBe("one\n- two\n- three");
    expect(prefixLines(sel("[one\ntwo\nthr]ee"), "- ").text).toBe("- one\n- two\n- three");
  });

  it("un-bullets only when every line already has one", () => {
    // A half-bulleted block completes rather than clearing, which is what
    // somebody selecting a mixed block is asking for.
    const partly = { value: "- one\ntwo", start: 0, end: 9 };
    expect(prefixLines(partly, "- ").text).toBe("- one\n- two");

    const fully = { value: "- one\n- two", start: 0, end: 11 };
    expect(prefixLines(fully, "- ").text).toBe("one\ntwo");
  });

  it("turns a bullet into a heading without leaving the dash behind", () => {
    expect(prefixLines(sel("- item[]"), "# ").text).toBe("# item");
  });
});

describe("link", () => {
  it("leaves the address selected, so it can be typed straight over", () => {
    expect(show(link(sel("see [our terms] here"))).replace(/\n/g, "\\n")).toBe(
      "see [our terms]([https://]) here"
    );
  });

  it("gives placeholder text when nothing was selected", () => {
    const edit = link(sel("see []here"));
    expect(edit.text).toBe("see [link text](https://)here");
    // Still the URL that is selected: the label is easy to fix, the address is
    // the part that must not be forgotten.
    expect(edit.text.slice(edit.selectionStart, edit.selectionEnd)).toBe("https://");
  });
});
