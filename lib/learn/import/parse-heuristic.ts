/**
 * Line-heuristic parsing of a pasted reading list, with no model involved.
 *
 * Two reasons this exists rather than the LLM path being the only one. The
 * module has to be developable without `ANTHROPIC_API_KEY`, the same way
 * lib/books/paste-list-heuristic.ts lets the book flow run dry. And a pasted
 * list is often already structured -- a bulleted reply, a syllabus, a set of
 * footnotes -- where splitting on lines is not a degraded answer, it is the
 * right one.
 *
 * Pure. Everything here runs against a string in a test.
 */

export type ReferenceCandidate = {
  /** The line as pasted, kept so the confirm screen can show what it read. */
  raw: string;
  title: string;
  author: string | null;
  /** A URL sitting in the text already. Saves a search when present. */
  url: string | null;
  /**
   * The rest of the line after the citation -- usually the recommender's own
   * reason. Carried through because "best fit for your intuition" is worth
   * more than anything the resolver will write.
   */
  why: string | null;
};

/** Bullets, numbering and the leading punctuation of a pasted list. */
const LEADER = /^\s*(?:[-–—*•·]|\d+[.)])\s*/;

/** A line that is only decoration. */
const DECORATION = /^[-–—*•·.\s_=]+$/;

/**
 * Lines that introduce a list rather than being in it.
 *
 * "Here are some things to read:" is not a book. Kept short and literal --
 * guessing harder throws away real entries, and a junk row costs one untick on
 * a screen you were already looking at.
 */
const PREAMBLE = /^(?:here (?:are|is)\b|some\b.*\bto read\b|suggested reading\b|reading list\b|sources?\b\s*:?\s*$|further reading\b)/i;

const URL_PATTERN = /https?:\/\/[^\s<>()[\]"']+/i;

/**
 * Where a citation stops and commentary starts.
 *
 * A recommendation is usually "Author, Title, then why it is here", and the
 * why runs on for a sentence or two. Splitting on the first sentence end that
 * follows enough text keeps the citation clean without discarding the reason.
 */
function splitCitationFromComment(line: string): { citation: string; why: string | null } {
  // An em dash or a colon is the most common separator and the most reliable.
  const dash = line.match(/^(.{8,}?)\s+[—–]\s+(.+)$/);
  if (dash) return { citation: dash[1].trim(), why: dash[2].trim() };

  // Otherwise the end of the first sentence, if there is a second.
  const sentence = line.match(/^(.{12,}?[.?!])\s+(\p{Lu}.+)$/u);
  if (sentence) return { citation: sentence[1].replace(/[.?!]$/, '').trim(), why: sentence[2].trim() };

  return { citation: line, why: null };
}

/**
 * Pull an author off the front or back of a citation.
 *
 * Both orders show up constantly and neither is safe to assume:
 *   "Sen, Inequality Reexamined"          -> author first
 *   "Spheres of Justice by Michael Walzer" -> author last
 *
 * When neither pattern fits, the whole thing is the title. A wrong author is
 * worse than a missing one, because the resolver searches on it.
 */
function splitAuthor(citation: string): { title: string; author: string | null } {
  const by = citation.match(/^(.+?)\s+by\s+(.+)$/i);
  if (by) return { title: by[1].trim(), author: by[2].trim() };

  // "Surname, Title". Both halves have to agree before this fires, because
  // "Prices, markets and the coordination problem" is one title whose first
  // word is as name-shaped as "Sen" is.
  //
  // The head reads as a name: capitalised words, no internal punctuation.
  // The tail reads as a title: it starts with a capital, a digit or a quote.
  // "markets and the coordination problem" does not, which is what separates
  // the two cases. A wrong author is worse than a missing one, because the
  // resolver searches on it.
  const comma = citation.match(/^([^,]{2,40}),\s+(.{4,})$/);
  if (comma) {
    const head = comma[1].trim();
    const tail = comma[2].trim();
    const headIsName = /^[\p{Lu}][\p{L}.'’-]*(?:\s+[\p{Lu}][\p{L}.'’-]*){0,3}$/u.test(head);
    const tailIsTitle = /^[\p{Lu}\d"“'‘]/u.test(tail);
    if (headIsName && tailIsTitle) return { title: tail, author: head };
  }

  return { title: citation.trim(), author: null };
}

/** Trailing quotes and brackets a citation picks up in prose. */
function unwrap(text: string): string {
  return text
    .replace(/^[“"'‘(\[]+/, '')
    .replace(/[”"'’)\].,;:]+$/, '')
    .trim();
}

export function heuristicParseReferences(text: string): ReferenceCandidate[] {
  const out: ReferenceCandidate[] = [];

  for (const line of text.split(/\r?\n/)) {
    const stripped = line.replace(LEADER, '').trim();
    if (!stripped || DECORATION.test(stripped)) continue;
    if (PREAMBLE.test(stripped)) continue;

    const urlMatch = stripped.match(URL_PATTERN);
    const url = urlMatch ? urlMatch[0] : null;
    const withoutUrl = url ? stripped.replace(url, '').trim() : stripped;

    const { citation, why } = splitCitationFromComment(withoutUrl);
    const { title, author } = splitAuthor(unwrap(citation));

    // A line that is only a URL still names something worth resolving; the
    // resolver will find its title. A line that is neither is not a reference.
    if (!title && !url) continue;

    out.push({
      raw: line.trim(),
      title: title || (url ?? ''),
      author,
      url,
      why: why ? unwrap(why) : null,
    });
  }

  return out;
}
