/**
 * Where a margin note sits in the essay (plan #1869; docs/LEARN-ESSAYS-SPEC.md,
 * "Margin notes and checks").
 *
 * A note is stored as the text it is about, about 32 characters either side,
 * and the offset as a hint. While the editor is open the note's range moves
 * with each edit (notes-editor.ts); on load it is found again from what was
 * stored, by the offset, then the exact quote, then a fuzzy match, and a
 * note whose text has gone is shown as detached. Offsets are UTF-16 units of
 * the draft, as the editor counts them. Pure, so tested, and run on both the
 * server (on load) and the client (placing a note a check just raised).
 */

export type Anchor = {
  quote: string;
  prefix: string;
  suffix: string;
  /** Where the quote started when the anchor was taken; a hint, not a promise. */
  offset: number | null;
};

export type Located = { from: number; to: number; how: 'offset' | 'quote' | 'fuzzy' };

/** Characters of context kept either side of the quote. */
export const ANCHOR_CONTEXT = 32;

/** How alike a passage must be to the stored quote to be taken as it, edited. */
export const FUZZY_FLOOR = 0.6;

/** The anchor for a range of the draft. */
export function makeAnchor(doc: string, from: number, to: number): Anchor {
  const start = Math.max(0, Math.min(from, doc.length));
  const end = Math.max(start, Math.min(to, doc.length));
  return {
    quote: doc.slice(start, end),
    prefix: doc.slice(Math.max(0, start - ANCHOR_CONTEXT), start),
    suffix: doc.slice(end, end + ANCHOR_CONTEXT),
    offset: start,
  };
}

/** How many characters the two strings share at their facing ends. */
function sharedTail(a: string, b: string): number {
  let n = 0;
  while (n < a.length && n < b.length && a[a.length - 1 - n] === b[b.length - 1 - n]) n += 1;
  return n;
}

function sharedHead(a: string, b: string): number {
  let n = 0;
  while (n < a.length && n < b.length && a[n] === b[n]) n += 1;
  return n;
}

/** How well the text around a position matches the stored context. */
function contextScore(doc: string, from: number, to: number, anchor: Anchor): number {
  const before = doc.slice(Math.max(0, from - anchor.prefix.length), from);
  const after = doc.slice(to, to + anchor.suffix.length);
  return sharedTail(before, anchor.prefix) + sharedHead(after, anchor.suffix);
}

/** Letter pairs of a text, lower-cased with runs of space closed up. */
function bigrams(text: string): Map<string, number> {
  const flat = text.toLowerCase().replace(/\s+/g, ' ');
  const pairs = new Map<string, number>();
  for (let i = 0; i < flat.length - 1; i += 1) {
    const pair = flat.slice(i, i + 2);
    pairs.set(pair, (pairs.get(pair) ?? 0) + 1);
  }
  return pairs;
}

/** Dice's coefficient over letter pairs: 1 for the same text, 0 for nothing shared. */
export function similarity(a: string, b: string | Map<string, number>): number {
  const left = bigrams(a);
  const right = typeof b === 'string' ? bigrams(b) : b;
  let total = 0;
  for (const n of left.values()) total += n;
  for (const n of right.values()) total += n;
  if (total === 0) return typeof b === 'string' && a.trim() === b.trim() ? 1 : 0;
  let shared = 0;
  for (const [pair, n] of left) shared += Math.min(n, right.get(pair) ?? 0);
  return (2 * shared) / total;
}

/** Where words start, the places a fuzzy match may begin or end. */
function wordStarts(doc: string): number[] {
  const starts: number[] = [];
  const pattern = /\S+/g;
  for (let m = pattern.exec(doc); m; m = pattern.exec(doc)) starts.push(m.index);
  return starts;
}

/**
 * The passage most like the quote, starting and ending on a word, when one
 * reaches FUZZY_FLOOR. Windows of about the quote's length are tried from
 * every word; the stored context breaks a tie.
 */
function fuzzy(doc: string, anchor: Anchor): Located | null {
  const quote = anchor.quote.trim();
  if (quote.length < 8) return null;
  const target = bigrams(quote);
  const starts = wordStarts(doc);
  const ends = [...starts.slice(1), doc.length];
  let best: { from: number; to: number; score: number; context: number } | null = null;
  for (let i = 0; i < starts.length; i += 1) {
    const from = starts[i];
    // The ends nearest the quote's length, a little shorter and longer, so a
    // sentence that gained or lost a few words is still found.
    for (let j = i; j < ends.length; j += 1) {
      const raw = ends[j];
      const length = raw - from;
      if (length < quote.length * 0.7) continue;
      if (length > quote.length * 1.4 + 10) break;
      const to = from + doc.slice(from, raw).trimEnd().length;
      const score = similarity(doc.slice(from, to), target);
      if (score < FUZZY_FLOOR) continue;
      const context = contextScore(doc, from, to, anchor);
      if (!best || score > best.score + 0.01 || (Math.abs(score - best.score) <= 0.01 && context > best.context)) {
        best = { from, to, score, context };
      }
    }
  }
  return best ? { from: best.from, to: best.to, how: 'fuzzy' } : null;
}

/**
 * The note's place in the draft as it is now, or null when its text has gone
 * (the note is then shown as detached). The offset first, when the quote is
 * still there; then every place the exact quote appears, the one whose
 * surroundings match best and, after that, the nearest the old offset; then
 * the passage most like it.
 */
export function locateAnchor(doc: string, anchor: Anchor): Located | null {
  const { quote, offset } = anchor;
  if (quote === '') return null;
  if (offset !== null && offset >= 0 && doc.slice(offset, offset + quote.length) === quote) {
    return { from: offset, to: offset + quote.length, how: 'offset' };
  }
  let best: { from: number; context: number; distance: number } | null = null;
  for (let at = doc.indexOf(quote); at >= 0; at = doc.indexOf(quote, at + 1)) {
    const context = contextScore(doc, at, at + quote.length, anchor);
    const distance = offset === null ? 0 : Math.abs(at - offset);
    if (!best || context > best.context || (context === best.context && distance < best.distance)) {
      best = { from: at, context, distance };
    }
  }
  if (best) return { from: best.from, to: best.from + quote.length, how: 'quote' };
  return fuzzy(doc, anchor);
}
