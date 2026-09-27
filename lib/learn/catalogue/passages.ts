import { isSearchableSection } from '@/lib/learn/catalogue/searchable';

/**
 * Cutting an article section into passages, for search only.
 *
 * The section trial on #760 (docs/trials/2026-09-26-wikipedia-sections.md)
 * found that a section teaching a claim in one sentence among several topics
 * scores under the 0.5 floor: the Tell lead mentions Alexander's conquest once
 * and the conquest claims reached it at 0.33 to 0.42. A section's vector is
 * the average of everything it covers, so one sentence is diluted by the rest.
 * A passage of a few hundred characters is close to one topic, so its vector
 * is close to what that topic says.
 *
 * Passages live in `learn.catalogue_passages` (learn migration 0070), each
 * pointing at its section. The nearest search scores a section by its best
 * passage and hands the section on, so the judge, links, judgements and
 * readings all stay per section.
 *
 * The cut is pure and deterministic, so re-cutting the same text gives the
 * same passages in the same order. That is what makes the writers idempotent:
 * they upsert on `(segment_id, ordinal)` and keep a passage's vector when its
 * text did not change.
 */

/** The size a passage is packed towards, in characters. */
export const PASSAGE_MIN_CHARS = 300;
export const PASSAGE_MAX_CHARS = 800;

/**
 * Split text into sentences, keeping each sentence's closing punctuation.
 *
 * A sentence ends at `.`, `!` or `?` (optionally followed by a closing quote
 * or bracket) and whitespace. Good enough for packing: a split in the wrong
 * place inside an abbreviation only moves a passage boundary a few words.
 */
function sentences(paragraph: string): string[] {
  return paragraph
    .split(/(?<=[.!?]["'”’)\]]?)\s+/)
    .map((sentence) => sentence.trim())
    .filter(Boolean);
}

/** Hard-split a run with no sentence break at the last space before the limit. */
function byWords(text: string, max: number): string[] {
  const out: string[] = [];
  let rest = text;
  while (rest.length > max) {
    const space = rest.lastIndexOf(' ', max);
    const cut = space > 0 ? space : max;
    out.push(rest.slice(0, cut).trim());
    rest = rest.slice(cut).trim();
  }
  if (rest) out.push(rest);
  return out;
}

/** Pack pieces into runs of at most `max`, joined by `joiner`. */
function pack(pieces: string[], max: number, joiner: string): string[] {
  const out: string[] = [];
  let current = '';
  for (const piece of pieces) {
    if (!current) current = piece;
    else if (current.length + joiner.length + piece.length <= max) current += joiner + piece;
    else {
      out.push(current);
      current = piece;
    }
  }
  if (current) out.push(current);
  return out;
}

/**
 * A paragraph as units of at most PASSAGE_MAX_CHARS: itself when it fits,
 * otherwise its sentences packed, and a sentence that is itself too long split
 * at a space.
 */
function unitsOf(paragraph: string): string[] {
  if (paragraph.length <= PASSAGE_MAX_CHARS) return [paragraph];
  const pieces = sentences(paragraph).flatMap((sentence) =>
    sentence.length <= PASSAGE_MAX_CHARS ? [sentence] : byWords(sentence, PASSAGE_MAX_CHARS),
  );
  return pack(pieces, PASSAGE_MAX_CHARS, ' ');
}

/**
 * Cut one section's text into passages of about 300 to 800 characters.
 *
 * Paragraphs are split on line breaks (Wikipedia's plain-text extract puts one
 * newline between paragraphs). A paragraph over 800 characters is split into
 * sentences first. The units are then packed in order: a unit joins the
 * passage being built while the result stays within 800 characters, and
 * always while that passage is still under 300, so a short paragraph is never
 * a passage of its own. A short tail joins the passage before it. So a
 * passage is rarely over 1,100 characters, and under 300 only when the whole
 * text is.
 *
 * Pure: the same text always gives the same passages.
 */
export function cutPassages(text: string): string[] {
  const paragraphs = text
    .split(/\n+/)
    .map((paragraph) => paragraph.replace(/\s+/g, ' ').trim())
    .filter(Boolean);
  const units = paragraphs.flatMap(unitsOf);

  const out: string[] = [];
  let current = '';
  for (const unit of units) {
    if (!current) current = unit;
    else if (current.length < PASSAGE_MIN_CHARS || current.length + 1 + unit.length <= PASSAGE_MAX_CHARS) {
      current += '\n' + unit;
    } else {
      out.push(current);
      current = unit;
    }
  }
  if (current) {
    if (current.length < PASSAGE_MIN_CHARS && out.length > 0) out[out.length - 1] += '\n' + current;
    else out.push(current);
  }
  return out;
}

/**
 * The passages a stored section should have: none for a section that is not
 * searchable (lib/learn/catalogue/searchable.ts), otherwise its cut.
 *
 * Takes the section as stored, so the backfill (#1133) can call it on
 * `catalogue_segments` rows without fetching the article again.
 */
export function passagesForSection(section: { heading: string | null; text: string }): string[] {
  return isSearchableSection(section) ? cutPassages(section.text) : [];
}

/** One `catalogue_passages` row, before it has an id or a vector. */
export type PassageRow = { segment_id: string; ordinal: number; text: string };

/**
 * The passage rows for a set of stored sections, each numbered from 0 within
 * its section. What both writers upsert.
 */
export function passageRowsForSections(
  sections: { id: string; heading: string | null; text: string }[],
): PassageRow[] {
  return sections.flatMap((section) =>
    passagesForSection(section).map((text, ordinal) => ({ segment_id: section.id, ordinal, text })),
  );
}
