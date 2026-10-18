/**
 * The experience a posting asks for, read from its description (note
 * a7495ede): a number range for the whole, and the lines themselves for what
 * the range leaves out. A posting that asks for "2+ years in startups" and
 * "5-10 years of client-facing experience" asks for 5 to 10 years in all, and
 * the two lines say which years count for what.
 *
 * Read from the description line by line. A line counts only when the years
 * are years of something (followed by "of", "in", "across" and the like, or
 * on a line that says experience), so the company's own story ("in five
 * years", "within its first year", "the next few years") is not taken for an
 * ask.
 */
export type ExperienceAsk = {
  /** The fewest years the widest ask names. */
  min: number;
  /** The most it names; null for an open-ended "5+ years". */
  max: number | null;
  /** Every line that asks for a number of years, in the description's order. */
  lines: string[];
};

const WORDS: Record<string, number> = {
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  twelve: 12,
  fifteen: 15,
};

const NUMBER = `(\\d{1,2}|${Object.keys(WORDS).join('|')})`;
const DASH = '\\s*(?:-|–|—|to|and)\\s*';

/**
 * A count of years: "5+ years", "5-8 years", "5 to 8 years", "between 2 and
 * 10 years", "6-8+ years", "Two or more years", "at least one year", "~1
 * year". The number has to sit right before "year", which is what keeps "a
 * team of 70 people" out.
 */
const YEARS = new RegExp(
  `(?:^|[^\\w.])~?${NUMBER}(?:${DASH}${NUMBER})?\\s*(\\+|\\s+or\\s+more|\\s+plus)?\\s+years?\\b`,
  'gi',
);

function count(word: string): number {
  const lower = word.toLowerCase();
  return WORDS[lower] ?? Number(lower);
}

/** What the years have to be of, right after them, for a line to be an ask. */
const OF_SOMETHING = /^\s*(?:of|in|across|at|working|with|as|doing|leading|managing|building|experience|relevant|professional|full-time|post-)/i;
/** Or the line says what it is about. */
const ABOUT = /\b(?:experience|background|track record|tenure)\b/i;
/**
 * The word before the count, when it makes the years a span of time instead,
 * or a boast ("building on more than 30 years of investing experience").
 */
const TIME_BEFORE = /\b(?:in|within|under|over|than|next|past|last|first|for|every|per)\s*~?$/i;

/** The asks on one line, as [min, max] pairs; max is null when open-ended. */
function asksIn(line: string): Array<[number, number | null]> {
  const found: Array<[number, number | null]> = [];
  for (const match of line.matchAll(YEARS)) {
    const at = match.index ?? 0;
    const before = line.slice(0, at + match[0].search(/[~\w]/));
    const after = line.slice(at + match[0].length);
    if (TIME_BEFORE.test(before.trimEnd())) continue;
    if (!OF_SOMETHING.test(after) && !ABOUT.test(line)) continue;
    const low = count(match[1]);
    const high = match[2] ? count(match[2]) : null;
    if (!Number.isFinite(low) || low <= 0 || low > 40) continue;
    if (high !== null && (!Number.isFinite(high) || high < low || high > 40)) continue;
    const open = Boolean(match[3]);
    found.push([low, open ? null : (high ?? low)]);
  }
  return found;
}

/** A line as the page shows it: no bullet, no markdown emphasis, one space. */
function clean(line: string): string {
  return line
    .replace(/^\s*(?:[-*•·▪◦]|\d+[.)])\s*/, '')
    .replace(/\*\*|__/g, '')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * What the description asks for, or null when no line asks for a number of
 * years. The range is the widest single ask: the one with the most years at
 * its top, an open-ended one counting from its floor.
 */
export function experienceAsk(jdText: string | null): ExperienceAsk | null {
  if (!jdText) return null;
  let best: [number, number | null] | null = null;
  const lines: string[] = [];
  for (const raw of jdText.split(/\n+/)) {
    const line = clean(raw);
    const asks = asksIn(line);
    if (asks.length === 0) continue;
    if (!lines.includes(line)) lines.push(line);
    for (const ask of asks) {
      const top = ask[1] ?? ask[0];
      const bestTop = best ? (best[1] ?? best[0]) : -1;
      if (!best || top > bestTop || (top === bestTop && ask[0] > best[0])) best = ask;
    }
  }
  if (!best) return null;
  return { min: best[0], max: best[1], lines };
}

/** "5–10 years", "5+ years", "1 year". */
export function experienceRange(ask: Pick<ExperienceAsk, 'min' | 'max'>): string {
  if (ask.max === null) return `${ask.min}+ years`;
  if (ask.max === ask.min) return `${ask.min} year${ask.min === 1 ? '' : 's'}`;
  return `${ask.min}–${ask.max} years`;
}
