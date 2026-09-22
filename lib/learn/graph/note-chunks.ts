/**
 * Cutting a vault note into the pieces extraction reads, all of it.
 *
 * Stage 1 of LEARN-MAP-SPEC.md. `splitBriefing` was written for a pasted
 * briefing, where somebody chose what to paste, and it stops after ten
 * sections. On the vault that read the largest note at 3.6% and left 40.7% of
 * the text in headed notes unread, with the best-organised notes losing the
 * most. This reads a note end to end instead:
 *
 * - it cuts on the note's own headings, and keeps whatever comes before the
 *   first one;
 * - a section under `NOTE_MERGE_BELOW` characters joins its neighbour, since a
 *   heading with a line under it is not worth a call of its own;
 * - a section over `NOTE_SECTION_CHARS` is cut at a paragraph break, or failing
 *   that a line, a sentence or a space, so one enormous block is never sent
 *   whole;
 * - the limit is on characters read, not on sections, and whatever falls past
 *   it is returned in `skipped` rather than dropped.
 *
 * Every chunk carries its offsets into the body it was cut from, so a quote
 * can be checked against the note and a skip can say exactly where it began.
 * Nothing here calls a model or reads a path: it takes the body and nothing
 * else.
 */

/** The most a chunk holds before it is cut. */
export const NOTE_SECTION_CHARS = 4000;

/** A section shorter than this joins its neighbour. */
export const NOTE_MERGE_BELOW = 200;

/**
 * The most of one note that is read. The largest note in the vault is 302,851
 * characters, so this reads every note there is today; it exists so that a
 * pasted book cannot run up a bill unnoticed, and what it stops is recorded.
 */
export const MAX_NOTE_READ_CHARS = 400_000;

/** One piece of a note, as `body.slice(start, end)`. */
export type NoteChunk = {
  /** The heading it sits under, or its first line when there is none. */
  title: string;
  text: string;
  start: number;
  end: number;
};

/** What was not read, and why. One record per contiguous stretch. */
export type NoteSkip = {
  reason: 'read-cap';
  start: number;
  end: number;
  /** Characters in the stretch, whitespace between chunks included. */
  chars: number;
  /** Chunks it would have been read in. */
  chunks: number;
  /** The title of the first chunk not read. */
  from: string;
  /** The sentence to show for it. */
  detail: string;
};

export type ChunkedNote = {
  chunks: NoteChunk[];
  /** The body's length. */
  chars: number;
  /** Characters inside the chunks returned. */
  readChars: number;
  /** Empty when the whole note is read. */
  skipped: NoteSkip[];
};

const ATX_HEADING = /^ {0,3}(#{1,6})\s+(.+?)\s*#*\s*$/;
const FENCE = /^ {0,3}(`{3,}|~{3,})/;

type Range = { title: string; start: number; end: number };

function shorten(text: string): string {
  return text.length > 80 ? `${text.slice(0, 77)}…` : text;
}

/** The first non-blank line of a stretch, to name it by. */
function firstLine(text: string): string {
  const line =
    text
      .split('\n')
      .find((l) => l.trim().length > 0)
      ?.trim() ?? 'Untitled section';
  return shorten(line.replace(ATX_HEADING, '$2'));
}

/** Where the non-whitespace in `body.slice(start, end)` begins and ends. */
function tighten(body: string, start: number, end: number): [number, number] {
  let s = start;
  let e = end;
  while (s < e && /\s/.test(body[s]!)) s++;
  while (e > s && /\s/.test(body[e - 1]!)) e--;
  return [s, e];
}

const solid = (body: string, r: { start: number; end: number }) => {
  const [s, e] = tighten(body, r.start, r.end);
  return e - s;
};

/** The note's headings, outside fenced code, as ranges running to the next. */
function sections(body: string): Range[] {
  const starts: { at: number; title: string }[] = [];
  let fence: string | null = null;
  let at = 0;

  for (const line of body.split('\n')) {
    const bare = line.replace(/\r$/, '');
    const opens = FENCE.exec(bare);
    if (opens) {
      const mark = opens[1]![0]!;
      if (fence === null) fence = mark;
      else if (fence === mark) fence = null;
    } else if (fence === null) {
      const heading = ATX_HEADING.exec(bare);
      if (heading) starts.push({ at, title: shorten(heading[2]!) });
    }
    at += line.length + 1;
  }

  const ranges: Range[] = [];
  const first = starts[0]?.at ?? body.length;
  if (first > 0) ranges.push({ title: firstLine(body.slice(0, first)), start: 0, end: first });
  starts.forEach((s, i) => {
    ranges.push({ title: s.title, start: s.at, end: starts[i + 1]?.at ?? body.length });
  });
  return ranges.filter((r) => solid(body, r) > 0);
}

/** Fold every section under `below` characters into its neighbour. */
function merge(body: string, ranges: Range[], below: number): Range[] {
  const out: Range[] = [];
  let pending: Range | null = null;

  for (const range of ranges) {
    if (pending) {
      // The heading with substance names the pair, not the stub before it.
      const title: string =
        solid(body, range) >= solid(body, pending) ? range.title : pending.title;
      pending = { title, start: pending.start, end: range.end };
    } else {
      pending = range;
    }
    if (solid(body, pending) >= below) {
      out.push(pending);
      pending = null;
    }
  }
  if (pending) {
    const last = out.pop();
    out.push(last ? { title: last.title, start: last.start, end: pending.end } : pending);
  }
  return out;
}

/**
 * Cut `text.slice(start, end)` into pieces of at most `size` characters.
 *
 * Each cut is the latest good boundary in the second half of the window, so no
 * piece is under half the size unless it is the last: a paragraph break first,
 * then a line end, then the end of a sentence, then any space, and only when
 * there is none of those a hard cut, kept off the middle of a surrogate pair.
 */
export function cutLong(
  text: string,
  start: number,
  end: number,
  size: number,
): Array<[number, number]> {
  const pieces: Array<[number, number]> = [];
  let s = start;

  const last = (pattern: RegExp, from: number, to: number): number | null => {
    const window = text.slice(from, to);
    let found: number | null = null;
    for (const match of window.matchAll(pattern)) {
      found = from + match.index! + match[0].length;
    }
    return found;
  };

  while (end - s > size) {
    const lo = s + Math.floor(size / 2);
    const hi = s + size;
    let cut =
      last(/\n[ \t]*\r?\n/g, lo, hi) ??
      last(/\n/g, lo, hi) ??
      last(/[.!?]["')\]]*\s+/g, lo, hi) ??
      last(/\s+/g, lo, hi) ??
      hi;
    if (cut === hi) {
      const code = text.charCodeAt(cut - 1);
      if (code >= 0xd800 && code <= 0xdbff) cut -= 1;
    }
    pieces.push([s, cut]);
    s = cut;
  }
  if (end > s) pieces.push([s, end]);
  return pieces;
}

/**
 * The whole of a note, in the pieces extraction reads, with anything past the
 * read limit returned as a skip against the note rather than left out.
 */
export function chunkNote(
  body: string,
  options: { sectionChars?: number; mergeBelow?: number; maxReadChars?: number } = {},
): ChunkedNote {
  const size = options.sectionChars ?? NOTE_SECTION_CHARS;
  const below = options.mergeBelow ?? NOTE_MERGE_BELOW;
  const limit = options.maxReadChars ?? MAX_NOTE_READ_CHARS;

  const all: NoteChunk[] = [];
  for (const range of merge(body, sections(body), below)) {
    cutLong(body, range.start, range.end, size).forEach(([from, to], part) => {
      const [s, e] = tighten(body, from, to);
      if (e <= s) return;
      all.push({
        title: part === 0 ? range.title : `${range.title} (continued)`,
        text: body.slice(s, e),
        start: s,
        end: e,
      });
    });
  }

  const chunks: NoteChunk[] = [];
  let readChars = 0;
  for (const chunk of all) {
    const length = chunk.end - chunk.start;
    if (readChars + length > limit) break;
    chunks.push(chunk);
    readChars += length;
  }

  const skipped: NoteSkip[] = [];
  const over = all.slice(chunks.length);
  if (over.length > 0) {
    const first = over[0]!;
    const chars = body.length - first.start;
    skipped.push({
      reason: 'read-cap',
      start: first.start,
      end: body.length,
      chars,
      chunks: over.length,
      from: first.title,
      detail: `The last ${chars.toLocaleString('en-GB')} characters, from “${first.title}” on, were not read: a note is read up to ${limit.toLocaleString('en-GB')} characters.`,
    });
  }

  return { chunks, chars: body.length, readChars, skipped };
}
