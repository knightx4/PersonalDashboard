// Joining one note's text onto the end of another (plan #2357.2).
//
// The incoming text goes at the end of the receiving text under a heading with
// the date and the other note's title. Nothing already in the receiving text
// changes, its frontmatter included, and pressing the button twice adds
// nothing the second time.

const FRONTMATTER = /^---\r?\n[\s\S]*?\r?\n---[ \t]*(?:\r?\n|$)/;

/** The text without a leading frontmatter block. */
function withoutFrontmatter(text: string): string {
  return text.replace(FRONTMATTER, "");
}

/**
 * Returns `receiving` with `incoming` added at the end under
 * `## <date> · <title>`, a blank line between the parts. The incoming text's
 * own frontmatter is left out, since a second block in the middle of a note is
 * not frontmatter. Returns `receiving` unchanged when `incoming` has no text
 * or is already the last block.
 */
export function joinNotes(
  receiving: string,
  incoming: string,
  title: string,
  date: string,
): string {
  const body = withoutFrontmatter(incoming).trim();
  if (body === "") return receiving;
  const tail = receiving.trimEnd();
  // Already the last block: it ends the text and starts at a line start, so a
  // body that merely matches the end of a longer line does not count.
  if (tail.endsWith(body) && /(^|\n)$/.test(tail.slice(0, tail.length - body.length))) {
    return receiving;
  }

  const heading = `## ${date} · ${title.trim() || "Untitled"}`;
  const block = `${heading}\n\n${body}\n`;
  const head = receiving.trimEnd();
  if (head === "") return block;
  // Keep the receiving text as it was; only trailing whitespace is replaced
  // by the blank line that separates the parts.
  return `${head}\n\n${block}`;
}
