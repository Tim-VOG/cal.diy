/**
 * What each formatting button does to the text, as arithmetic on a string.
 *
 * Kept apart from the toolbar that calls it because the interesting part is not
 * the buttons: it is where the caret ends up, and whether pressing the same
 * button twice undoes itself rather than producing `**​**bold**​**`. That is
 * testable, and a toolbar is not.
 *
 * Everything here produces MARKDOWN, which is what the column already holds and
 * what markdownToSafeHTML already renders and sanitises. Storing HTML instead
 * would have moved an admin-authored string one step closer to the page.
 */

export interface Edit {
  text: string;
  /** Where the selection should sit afterwards, as offsets into `text`. */
  selectionStart: number;
  selectionEnd: number;
}

export interface Selection {
  value: string;
  start: number;
  end: number;
}

/**
 * Wrap the selection in a marker, or take the marker off if it is already
 * there.
 *
 * Underline is the odd one: Markdown has no syntax for it, so it uses the HTML
 * tag. That survives the pipeline — markdown-it runs with html:true and
 * sanitize-html's defaults allow `u` — which was worth checking rather than
 * assuming, since a button that silently produces nothing is worse than no
 * button.
 */
export function wrap(sel: Selection, before: string, after = before): Edit {
  const { value } = sel;

  // Markdown's emphasis markers have to touch the text: "** bold **" is not
  // bold, it is four literal asterisks around a word. Selecting a word by
  // double-clicking or dragging very often takes a space with it, so the
  // whitespace is pushed back OUTSIDE the markers rather than wrapped. This is
  // what every editor does, and its absence is why the first bold anyone tried
  // came out as "** xxx **".
  const raw = value.slice(sel.start, sel.end);
  const leading = raw.length - raw.trimStart().length;
  const trailing = raw.length - raw.trimEnd().length;
  const start = raw.trim() ? sel.start + leading : sel.start;
  const end = raw.trim() ? sel.end - trailing : sel.end;
  const selected = value.slice(start, end);

  // Already wrapped, either inside the markers or around them.
  const inside = value.slice(start - before.length, start) === before && value.slice(end, end + after.length) === after;
  if (inside) {
    const text = value.slice(0, start - before.length) + selected + value.slice(end + after.length);
    return { text, selectionStart: start - before.length, selectionEnd: end - before.length };
  }
  if (selected.startsWith(before) && selected.endsWith(after) && selected.length >= before.length + after.length) {
    const bare = selected.slice(before.length, selected.length - after.length);
    const text = value.slice(0, start) + bare + value.slice(end);
    return { text, selectionStart: start, selectionEnd: start + bare.length };
  }

  const text = value.slice(0, start) + before + selected + after + value.slice(end);
  return { text, selectionStart: start + before.length, selectionEnd: start + before.length + selected.length };
}

/** The bounds of the whole lines the selection touches. */
function lineBounds(value: string, start: number, end: number): [number, number] {
  const from = value.lastIndexOf("\n", start - 1) + 1;
  const nextBreak = value.indexOf("\n", end);
  return [from, nextBreak === -1 ? value.length : nextBreak];
}

/** Any heading or bullet already at the head of a line. */
const EXISTING_PREFIX = /^(#{1,6} |- )/;

/**
 * Put a prefix at the head of every line the selection touches — a heading
 * level, or a bullet.
 *
 * Replaces whatever prefix is already there rather than stacking on it, and
 * removes it when it is the same one: clicking H2 twice should give back a
 * paragraph, not `## ## `.
 */
export function prefixLines(sel: Selection, prefix: string): Edit {
  const { value, start, end } = sel;
  const [from, to] = lineBounds(value, start, end);
  const block = value.slice(from, to);

  const lines = block.split("\n");
  const allHavePrefix = lines.every((line) => line.startsWith(prefix));
  const next = lines
    .map((line) => {
      const bare = line.replace(EXISTING_PREFIX, "");
      return allHavePrefix ? bare : prefix + bare;
    })
    .join("\n");

  const text = value.slice(0, from) + next + value.slice(to);
  return { text, selectionStart: from, selectionEnd: from + next.length };
}

/**
 * Turn the selection into a link, leaving the URL selected so it can be typed
 * over straight away.
 *
 * No dialog: a prompt for the address is one more thing to dismiss, and the
 * placeholder says what to replace.
 */
export function link(sel: Selection, placeholder = "https://"): Edit {
  const { value, start, end } = sel;
  const selected = value.slice(start, end) || "link text";
  const inserted = `[${selected}](${placeholder})`;
  const text = value.slice(0, start) + inserted + value.slice(end);
  const urlAt = start + selected.length + 3;
  return { text, selectionStart: urlAt, selectionEnd: urlAt + placeholder.length };
}
