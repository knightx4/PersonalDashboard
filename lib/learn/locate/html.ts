/**
 * Turning a fetched page into a place you can be sent.
 *
 * Pure, and deliberately so: everything here is testable against a string, and
 * the one part that talks to the network lives behind lib/learn/providers/.
 *
 * The output is a *text fragment* URL rather than a stored excerpt. A browser
 * given `...#:~:text=The%20marvel%20is` scrolls to that sentence and highlights
 * it. That means nothing is copied into this database, nothing goes stale when
 * the page is edited, and the reader lands on the source rather than on our
 * paraphrase of it. Supported in current Chrome, Edge, Safari and Firefox; a
 * browser that does not understand the fragment simply opens the page, which
 * is the same place they would have got anyway.
 */

const BLOCK_TAGS =
  /<\/?(p|div|section|article|h[1-6]|li|ul|ol|tr|td|th|blockquote|pre|br|hr|main|header|footer|figure|figcaption)\b[^>]*>/gi;

const DROPPED_ELEMENTS = /<(script|style|noscript|svg|template|iframe)\b[^>]*>[\s\S]*?<\/\1>/gi;

const ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  mdash: '—',
  ndash: '–',
  hellip: '…',
  lsquo: '‘',
  rsquo: '’',
  ldquo: '“',
  rdquo: '”',
};

function decodeEntities(input: string): string {
  return input.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (match, body: string) => {
    if (body.startsWith('#')) {
      const code = body[1] === 'x' || body[1] === 'X'
        ? Number.parseInt(body.slice(2), 16)
        : Number.parseInt(body.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff
        ? String.fromCodePoint(code)
        : match;
    }
    return ENTITIES[body.toLowerCase()] ?? match;
  });
}

/**
 * A page's readable text.
 *
 * Not a Readability implementation and not trying to be: navigation and
 * footers coming through costs a model a few hundred wasted tokens, whereas
 * dropping the article body because a heuristic guessed wrong costs the whole
 * feature. Script and style content is removed because it is not prose in any
 * sense and would otherwise be matched against.
 */
export function toPlainText(html: string): string {
  return decodeEntities(
    html
      .replace(DROPPED_ELEMENTS, ' ')
      .replace(/<!--[\s\S]*?-->/g, ' ')
      .replace(BLOCK_TAGS, '\n')
      .replace(/<[^>]+>/g, ''),
  )
    .replace(/[ \t ]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/^[ \t]+|[ \t]+$/gm, '')
    .trim();
}

/**
 * Whitespace and quote marks, flattened.
 *
 * A model asked for a phrase from a document reproduces it with straight
 * quotes where the page had curly ones, and with its own idea of line breaks.
 * Neither difference means it made the passage up, and both would fail a
 * literal comparison. Browsers normalise whitespace when matching a text
 * fragment too, so this is the same comparison the browser will make.
 */
export function normalize(text: string): string {
  return text
    .replace(/[‘’‚‛]/g, "'")
    .replace(/[“”„‟]/g, '"')
    .replace(/[‐-―]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

/**
 * Did the model quote the document, or invent the quote?
 *
 * This is the check that turns a proposed location into a verified one, and it
 * is the whole of "never send someone to a page that is not there": a phrase
 * that is not in the fetched text was hallucinated, and the locator falls back
 * to unverified rather than shipping a link that highlights nothing.
 */
export function containsAnchor(documentText: string, anchor: string): boolean {
  const needle = normalize(anchor);
  if (needle.length < 12) return false;
  return normalize(documentText).includes(needle);
}

/**
 * Percent-encoding for the text-fragment directive.
 *
 * `-` and `,` are syntax inside `:~:text=` -- they separate prefix, start, end
 * and suffix -- so they have to be encoded even though encodeURIComponent
 * leaves them alone. `&` would end the directive.
 */
function encodeFragmentPart(text: string): string {
  return encodeURIComponent(text).replace(/-/g, '%2D').replace(/,/g, '%2C');
}

/** Words, for trimming a long passage down to its ends. */
function words(text: string): string[] {
  return text.split(/\s+/).filter(Boolean);
}

const LONG_ANCHOR_WORDS = 12;
const EDGE_WORDS = 6;

/**
 * Build the URL the Open button uses.
 *
 * A short phrase goes in whole. A long one is sent as `textStart,textEnd` --
 * the first and last few words -- which is what the fragment syntax is for and
 * is far more robust: a page that gained a comma in the middle of a paragraph
 * still matches on its ends.
 *
 * Any existing fragment on the base URL is replaced. A URL that already
 * carries `#:~:text=` was built by this function on an earlier pass.
 */
export function buildTextFragmentUrl(baseUrl: string, anchor: string): string {
  const url = new URL(baseUrl);
  url.hash = '';

  const cleaned = anchor.replace(/\s+/g, ' ').trim();
  const parts = words(cleaned);

  const directive =
    parts.length > LONG_ANCHOR_WORDS
      ? `${encodeFragmentPart(parts.slice(0, EDGE_WORDS).join(' '))},${encodeFragmentPart(
          parts.slice(-EDGE_WORDS).join(' '),
        )}`
      : encodeFragmentPart(cleaned);

  return `${url.toString()}#:~:text=${directive}`;
}

/** `...#page=12`, for a PDF. Replaces any fragment already there. */
export function buildPdfPageUrl(baseUrl: string, page: number): string {
  const url = new URL(baseUrl);
  url.hash = '';
  return `${url.toString()}#page=${Math.max(1, Math.floor(page))}`;
}
