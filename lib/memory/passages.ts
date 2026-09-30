/**
 * Cutting a source row's text into passages (plan #1247).
 *
 * core.memory_sources gives each row a title and up to two texts, the
 * person's and Dash's. Each text is cut into passages of about
 * PASSAGE_TARGET characters, and every passage starts with the row's title,
 * so a passage read alone (as a search result, or by the embedder) still says
 * what it belongs to.
 *
 * Cuts fall at headings first: sections are packed into a passage until the
 * next would take it over the target. A section longer than the target is cut
 * at its blank lines, and its heading is repeated on each passage after the
 * first. A paragraph longer than the target on its own is cut at sentence
 * ends, and a sentence longer than that at the target itself.
 *
 * Pure and deterministic: the same row always gives the same passages, which
 * is what lets a row whose hash has not changed keep the passages it has.
 * Changing the rules here does not make existing rows stale, because the hash
 * is of the text rather than of the passages; clear core.memory_chunks for a
 * source to have it cut again.
 */

export type Author = 'me' | 'dash';

export type SourceText = {
  title: string | null;
  /** The person's text. */
  mine: string | null;
  /** Dash's text. */
  dash: string | null;
};

export type Passage = { author: Author; body: string };

/** About how long a passage is, in characters, not counting the title. */
export const PASSAGE_TARGET = 1_500;

const HEADING = /^#{1,6}\s+\S/;

/** Split markdown into sections, each starting at a heading line (or at the top). */
function sections(text: string): { heading: string | null; body: string }[] {
  const out: { heading: string | null; lines: string[] }[] = [{ heading: null, lines: [] }];
  let inFence = false;
  for (const line of text.split('\n')) {
    if (/^\s*(```|~~~)/.test(line)) inFence = !inFence;
    if (!inFence && HEADING.test(line)) {
      out.push({ heading: line.trim(), lines: [line] });
    } else {
      out[out.length - 1].lines.push(line);
    }
  }
  return out
    .map((section) => ({ heading: section.heading, body: section.lines.join('\n').trim() }))
    .filter((section) => section.body !== '');
}

/** Pieces of at most `max` characters, cut at sentence ends where there are any. */
function splitLong(text: string, max: number): string[] {
  if (text.length <= max) return [text];
  const sentences = text.match(/[^.!?\n]+(?:[.!?]+["')\]]*|\n|$)\s*/g) ?? [text];
  const pieces: string[] = [];
  let current = '';
  for (const sentence of sentences) {
    if (sentence.length > max) {
      if (current.trim()) pieces.push(current.trim());
      current = '';
      for (let at = 0; at < sentence.length; at += max) {
        const slice = sentence.slice(at, at + max).trim();
        if (slice) pieces.push(slice);
      }
      continue;
    }
    if (current.length + sentence.length > max && current.trim()) {
      pieces.push(current.trim());
      current = '';
    }
    current += sentence;
  }
  if (current.trim()) pieces.push(current.trim());
  return pieces;
}

/** Pack units into groups whose joined length stays at or under `max`. */
function pack(units: string[], max: number, joiner: string): string[] {
  const out: string[] = [];
  let current = '';
  for (const unit of units) {
    if (!current) {
      current = unit;
    } else if (current.length + joiner.length + unit.length <= max) {
      current += joiner + unit;
    } else {
      out.push(current);
      current = unit;
    }
  }
  if (current) out.push(current);
  return out;
}

/** Cut one text into passage bodies, without the title. */
export function cutText(text: string, target = PASSAGE_TARGET): string[] {
  const clean = text.replace(/\r\n?/g, '\n').trim();
  if (!clean) return [];
  if (clean.length <= target) return [clean];

  // Each section becomes one or more units no longer than the target.
  const units: string[] = [];
  for (const section of sections(clean)) {
    if (section.body.length <= target) {
      units.push(section.body);
      continue;
    }
    const paragraphs = section.body
      .split(/\n\s*\n/)
      .map((paragraph) => paragraph.trim())
      .filter(Boolean)
      .flatMap((paragraph) => splitLong(paragraph, target));
    const packed = pack(paragraphs, target, '\n\n');
    packed.forEach((piece, index) => {
      // The heading rides on every passage of a long section, so a passage
      // from its middle still says which part of the note it is.
      units.push(index > 0 && section.heading ? `${section.heading}\n\n${piece}` : piece);
    });
  }
  return pack(units, target, '\n\n');
}

/** Every passage of a row, the person's first and then Dash's. */
export function cutPassages(source: SourceText, target = PASSAGE_TARGET): Passage[] {
  const title = source.title?.trim() ?? '';
  const withTitle = (body: string) => (title && body !== title ? `${title}\n\n${body}` : body);

  const passages: Passage[] = [];
  for (const [author, text] of [
    ['me', source.mine],
    ['dash', source.dash],
  ] as const) {
    for (const body of cutText(text ?? '', target)) passages.push({ author, body: withTitle(body) });
  }

  // A row with a title and no text (a goal with no detail yet, an aim with no
  // description) is still something the person wrote: the title is the passage.
  if (passages.length === 0 && title) passages.push({ author: 'me', body: title });
  return passages;
}
