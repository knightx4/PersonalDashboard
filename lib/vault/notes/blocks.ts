import { createHash } from 'node:crypto';
import { basenameOf } from '@/lib/vault/paths';

/**
 * Splitting a vault note into passages (plan #1863.7, LEARN-ESSAYS-SPEC
 * "Schema"), so search can find the paragraph that matches and not only the
 * note.
 *
 * A note is cut at its Markdown headings (`#` to `######`, outside fenced
 * code and the frontmatter). A section longer than BLOCK_MAX_CHARS is cut
 * again at blank lines, so a long note with no headings still gives passages
 * of a few paragraphs. Each block keeps the headings above it, outermost
 * first.
 *
 * What is embedded is the block's place, then a blank line, then the passage:
 * `Folder > Note > Heading > Subheading`. The place is what tells a passage
 * that says "the second reason" which subject it belongs to. `textHash` is
 * the md5 of that text, and a block whose hash has not changed keeps its
 * vector when the note is split again (obsidian.store_note_blocks, 0035).
 *
 * Offsets count code points, which is what Postgres's substring counts, so
 * obsidian.nearest_note_blocks reads the passage straight out of the body.
 *
 * Pure: no database and no network, for the tests.
 */

/** A section longer than this is cut again at blank lines. */
export const BLOCK_MAX_CHARS = 2_000;

/** Characters of a block that are embedded, place included. */
export const BLOCK_EMBED_MAX_CHARS = 8_000;

/**
 * A block with fewer non-space characters than this, its heading line aside,
 * is kept without a vector: a heading on its own, or a line of tags, is not a
 * passage anyone is looking for.
 */
export const BLOCK_MIN_PROSE_CHARS = 20;

export type NoteBlock = {
  /** Order in the note, from 0. */
  position: number;
  headingPath: string[];
  /** Code-point offsets into the body, end exclusive. */
  start: number;
  end: number;
  /** The passage as it stands in the body. */
  text: string;
  /** What is embedded: the place, a blank line, the passage. */
  embedText: string;
  textHash: string;
  /** False for a block too short to search, which is stored with no vector. */
  searchable: boolean;
};

type Range = { start: number; end: number; headingPath: string[] };

const HEADING = /^ {0,3}(#{1,6})[ \t]+(.+?)[ \t]*#*[ \t]*$/;
const FENCE = /^ {0,3}(`{3,}|~{3,})/;

export function md5(text: string): string {
  return createHash('md5').update(text).digest('hex');
}

/** `Folder > Sub > Note`, from the note's path and title. */
export function notePlace(path: string, title: string | null): string[] {
  const cut = path.lastIndexOf('/');
  const folders = cut === -1 ? [] : path.slice(0, cut).split('/').filter(Boolean);
  const name = title?.trim() || basenameOf(path);
  return [...folders, name];
}

/** Where the body starts once a leading frontmatter block is set aside. */
function afterFrontmatter(body: string): number {
  const match = /^---[ \t]*\r?\n[\s\S]*?\r?\n---[ \t]*(\r?\n|$)/.exec(body);
  return match ? match[0].length : 0;
}

/** The lines of a body with where each starts, in UTF-16 units. */
function linesOf(body: string, from: number): { start: number; text: string }[] {
  const lines: { start: number; text: string }[] = [];
  let at = from;
  while (at < body.length) {
    const nl = body.indexOf('\n', at);
    const end = nl === -1 ? body.length : nl;
    lines.push({ start: at, text: body.slice(at, end).replace(/\r$/, '') });
    at = end + 1;
  }
  return lines;
}

/** The sections between headings, each with the headings above it. */
function sections(body: string): Range[] {
  const from = afterFrontmatter(body);
  const out: Range[] = [];
  const stack: { level: number; text: string }[] = [];
  let fence: string | null = null;
  let start = from;
  let path: string[] = [];

  for (const line of linesOf(body, from)) {
    const fenceMatch = FENCE.exec(line.text);
    if (fenceMatch) {
      const mark = fenceMatch[1];
      if (fence === null) fence = mark[0].repeat(mark.length);
      else if (mark[0] === fence[0] && mark.length >= fence.length) fence = null;
      continue;
    }
    if (fence !== null) continue;
    const heading = HEADING.exec(line.text);
    if (!heading) continue;

    if (line.start > start) out.push({ start, end: line.start, headingPath: path });
    const level = heading[1].length;
    while (stack.length > 0 && stack[stack.length - 1].level >= level) stack.pop();
    stack.push({ level, text: heading[2].trim() });
    path = stack.map((h) => h.text);
    start = line.start;
  }
  if (body.length > start) out.push({ start, end: body.length, headingPath: path });
  return out;
}

/** A range with its leading and trailing whitespace taken off, or null if blank. */
function trimmed(body: string, range: Range): Range | null {
  let { start, end } = range;
  while (start < end && /\s/.test(body[start])) start += 1;
  while (end > start && /\s/.test(body[end - 1])) end -= 1;
  return end > start ? { ...range, start, end } : null;
}

/** A long section cut at blank lines into pieces of at most BLOCK_MAX_CHARS. */
function pieces(body: string, range: Range): Range[] {
  if (range.end - range.start <= BLOCK_MAX_CHARS) return [range];
  const gap = /\n[ \t]*\r?\n/g;
  gap.lastIndex = range.start;
  const breaks: number[] = [];
  for (let m = gap.exec(body); m && m.index < range.end; m = gap.exec(body)) {
    breaks.push(m.index + m[0].length);
  }

  const out: Range[] = [];
  let start = range.start;
  let last = range.start;
  for (const at of breaks) {
    if (at - start > BLOCK_MAX_CHARS && last > start) {
      out.push({ ...range, start, end: last });
      start = last;
    }
    last = at;
  }
  if (range.end - start > BLOCK_MAX_CHARS && last > start && last < range.end) {
    out.push({ ...range, start, end: last });
    start = last;
  }
  out.push({ ...range, start, end: range.end });
  return out;
}

/** UTF-16 offsets to code-point offsets, in one pass when the body needs it. */
function codePointMap(body: string): (index: number) => number {
  if (!/[\uD800-\uDFFF]/.test(body)) return (index) => index;
  const map = new Int32Array(body.length + 1);
  let points = 0;
  for (let i = 0; i < body.length; i += 1) {
    map[i] = points;
    const code = body.charCodeAt(i);
    if (code >= 0xd800 && code <= 0xdbff && i + 1 < body.length) {
      // The pair's second half: no offset ever lands here, but keep it sane.
      map[i + 1] = points;
      i += 1;
    }
    points += 1;
  }
  map[body.length] = points;
  return (index) => map[index];
}

function proseChars(text: string): number {
  const first = text.split('\n', 1)[0];
  const rest = HEADING.test(first.replace(/\r$/, '')) ? text.slice(first.length) : text;
  return rest.replace(/\s/g, '').length;
}

/**
 * The note's blocks, in order. A note with anything in its body has at least
 * one: when nothing in it is a passage (frontmatter alone, say), the whole
 * body is one block with no vector, which marks the note as split.
 */
export function splitNoteBlocks(note: { path: string; title: string | null; body: string }): NoteBlock[] {
  const body = note.body ?? '';
  const place = notePlace(note.path, note.title);
  const toPoints = codePointMap(body);

  const ranges = sections(body)
    .map((range) => trimmed(body, range))
    .filter((range): range is Range => range !== null)
    .flatMap((range) => pieces(body, range))
    .map((range) => trimmed(body, range))
    .filter((range): range is Range => range !== null);

  const blocks = ranges.map((range, position): NoteBlock => {
    const text = body.slice(range.start, range.end);
    const embedText = `${[...place, ...range.headingPath].join(' > ')}\n\n${text}`.slice(
      0,
      BLOCK_EMBED_MAX_CHARS,
    );
    return {
      position,
      headingPath: range.headingPath,
      start: toPoints(range.start),
      end: toPoints(range.end),
      text,
      embedText,
      textHash: md5(embedText),
      searchable: proseChars(text) >= BLOCK_MIN_PROSE_CHARS,
    };
  });

  if (blocks.length === 0 && body.trim() !== '') {
    const embedText = `${place.join(' > ')}\n\n${body}`.slice(0, BLOCK_EMBED_MAX_CHARS);
    return [
      {
        position: 0,
        headingPath: [],
        start: 0,
        end: toPoints(body.length),
        text: body,
        embedText,
        textHash: md5(embedText),
        searchable: false,
      },
    ];
  }
  return blocks;
}
