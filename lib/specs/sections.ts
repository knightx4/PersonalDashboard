/**
 * Cutting a specification into sections you can comment on.
 *
 * A comment on a 650-line document is a comment on nothing. A comment on
 * "What an edge is" is a comment on a decision, and that is the unit this file
 * produces.
 *
 * Top-level headings only. The map spec has thirty `###` headings under eleven
 * `##` ones, and a thread under every third paragraph is a worse page than a
 * thread under every argument: the `##` sections are the things somebody
 * actually disagrees with.
 *
 * Pure, and tested, because the anchor is a key in the database: change how one
 * is derived and every comment already filed is orphaned.
 */

export type SpecSection = {
  /** Slugified heading. Stable while the heading is. */
  anchor: string;
  /** The heading as written, without its hashes. */
  heading: string;
  /** Everything under the heading, up to the next one. */
  body: string;
  position: number;
};

/**
 * A heading becomes an anchor.
 *
 * Lowercase, punctuation dropped, spaces to hyphens -- the convention GitHub
 * uses, so an anchor here matches the one a link into the file on GitHub would
 * use. Em dashes and curly quotes appear all over these documents and none of
 * them survive.
 */
export function anchorFor(heading: string): string {
  return heading
    .toLowerCase()
    .replace(/[`*_~]/g, '')
    .replace(/[^\p{L}\p{N}\s-]/gu, '')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

/** True for a fence line, so a `## ` inside a code block is not a heading. */
function isFence(line: string): boolean {
  return /^\s*(```|~~~)/.test(line);
}

/**
 * Split on `##`, keeping whatever comes before the first one.
 *
 * The preamble matters: every one of these documents opens with a paragraph
 * saying what the thing is and why it exists, and that is among the most
 * comment-worthy prose in the file. It is given the anchor `opening` rather
 * than being silently attached to the first real section.
 *
 * A `#` title line is dropped -- the page renders the document's name from the
 * registry, and printing it twice is the sort of thing nobody notices they are
 * reading around.
 */
export function splitSections(markdown: string): SpecSection[] {
  const lines = markdown.split('\n');
  const sections: SpecSection[] = [];

  let heading: string | null = null;
  let buffer: string[] = [];
  let fenced = false;
  const used = new Set<string>();

  function flush() {
    const body = buffer.join('\n').trim();
    // An empty preamble is nothing to comment on; an empty section still is,
    // because the heading itself is a claim about how the document is organised.
    if (heading === null && body === '') {
      buffer = [];
      return;
    }
    const text = heading ?? 'Opening';
    let anchor = heading === null ? 'opening' : anchorFor(text) || 'section';
    // Two sections have shared a heading in these documents more than once --
    // "Ordering notes worth respecting" appears twice in BUILD-ORDER.md.
    if (used.has(anchor)) {
      let n = 2;
      while (used.has(`${anchor}-${n}`)) n += 1;
      anchor = `${anchor}-${n}`;
    }
    used.add(anchor);
    sections.push({ anchor, heading: text, body, position: sections.length * 10 });
    buffer = [];
  }

  for (const line of lines) {
    if (isFence(line)) fenced = !fenced;

    if (!fenced) {
      const h2 = /^##\s+(.*\S)\s*$/.exec(line);
      if (h2) {
        flush();
        heading = h2[1].trim();
        continue;
      }
      // The document's own `# Title`, dropped once and only at the top.
      if (sections.length === 0 && heading === null && /^#\s+\S/.test(line)) continue;
    }

    buffer.push(line);
  }
  flush();

  return sections;
}
