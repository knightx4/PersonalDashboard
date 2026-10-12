/**
 * Who wrote which words of an essay (docs/LEARN-ESSAYS-SPEC.md, "Who wrote
 * what"; plan #1868, under #1863).
 *
 * In the editor and in `learn.essays.draft_authorship` the marks are UTF-16
 * ranges of the draft, the way CodeMirror and JavaScript count. Only the text
 * that is not the person's is marked: Dash's accepted suggestions (`dash`)
 * and quotes inserted from a note or source (`quote`). Everything else is
 * theirs.
 *
 * When the essay is written to the vault the marks become the note's
 * authorship block, in iA Writer's Markdown Annotations format (v0.2):
 * grapheme offsets from the start of the file, frontmatter included, under a
 * SHA-256 hash of the text they annotate, so an edit made in another editor
 * shows. The Obsidian Authorship plugin reads the same block, and its reading
 * rules are the ones followed here: the annotated text is the file before the
 * block with its trailing newlines removed, the hash is the first 32 hex
 * characters, and the block ends with a `...` line.
 *
 * Pure: no database, no editor, so all of it is tested.
 */

export const MARK_AUTHORS = ['dash', 'quote'] as const;
export type MarkAuthor = (typeof MARK_AUTHORS)[number];

/**
 * A run of text that is not the person's, as UTF-16 offsets. `name` is the
 * model for Dash's text and the note or source for a quote.
 */
export type AuthorMark = { author: MarkAuthor; from: number; to: number; name: string };

/** One range as `learn.essays.authorship` keeps it: graphemes from the start of the file. */
export type FileRange = { author: 'self' | MarkAuthor; start: number; length: number; name: string };

/** How many hex characters of the SHA-256 the header carries, as iA Writer and the plugin write it. */
export const HASH_LENGTH = 32;

/** The name the person's line takes when no display name is set, as the Obsidian plugin's default. */
export const DEFAULT_SELF_NAME = 'Self';

/** Dash's line in the block: `&Dash <model>`. */
export const DASH_NAME = 'Dash';

/* ---------- marks ---------- */

/** Sorted, clamped to the text, empty runs dropped and touching runs by the same author joined. */
export function normaliseMarks(marks: readonly AuthorMark[], length?: number): AuthorMark[] {
  const max = length ?? Number.POSITIVE_INFINITY;
  const sorted = marks
    .map((mark) => ({ ...mark, from: Math.max(0, Math.min(mark.from, max)), to: Math.max(0, Math.min(mark.to, max)) }))
    .filter((mark) => mark.to > mark.from)
    .sort((a, b) => a.from - b.from || a.to - b.to);
  const out: AuthorMark[] = [];
  for (const mark of sorted) {
    const last = out[out.length - 1];
    if (last && mark.from <= last.to) {
      if (last.author === mark.author && last.name === mark.name) {
        last.to = Math.max(last.to, mark.to);
        continue;
      }
      // Overlapping runs by different authors: the later one starts where the earlier ends.
      if (mark.to <= last.to) continue;
      out.push({ ...mark, from: last.to });
      continue;
    }
    out.push({ ...mark });
  }
  return out;
}

function isAuthor(value: unknown): value is MarkAuthor {
  return typeof value === 'string' && (MARK_AUTHORS as readonly string[]).includes(value);
}

/** The draft's marks from `draft_authorship`, anything malformed or past the text left out. */
export function readDraftMarks(value: unknown, length: number): AuthorMark[] {
  if (!Array.isArray(value)) return [];
  const marks: AuthorMark[] = [];
  for (const item of value) {
    if (!item || typeof item !== 'object') continue;
    const row = item as Record<string, unknown>;
    const start = row.start;
    const span = row.length;
    if (!isAuthor(row.author)) continue;
    if (!Number.isInteger(start) || !Number.isInteger(span)) continue;
    const from = start as number;
    const to = from + (span as number);
    if (from < 0 || to > length) continue;
    marks.push({ author: row.author, from, to, name: typeof row.name === 'string' ? row.name : '' });
  }
  return normaliseMarks(marks, length);
}

/** The marks as `draft_authorship` keeps them. */
export function draftMarksJson(marks: readonly AuthorMark[]): { author: MarkAuthor; start: number; length: number; name: string }[] {
  return normaliseMarks(marks).map((mark) => ({
    author: mark.author,
    start: mark.from,
    length: mark.to - mark.from,
    name: mark.name,
  }));
}

/** The parts of a change set the marks are mapped through; CodeMirror's ChangeDesc has both. */
export type ChangeShape = {
  iterGaps(f: (posA: number, posB: number, length: number) => void): void;
  iterChangedRanges(f: (fromA: number, toA: number, fromB: number, toB: number) => void, individual?: boolean): void;
};

/**
 * The marks after a change. Text the change left alone keeps its author;
 * text it removed takes its mark with it; text it inserted is the person's,
 * unless `inserted` says it came from Dash or a quote. So typing inside
 * Dash's sentence splits the mark around what you typed, and the words you
 * rewrite become yours.
 */
export function mapMarks(
  marks: readonly AuthorMark[],
  changes: ChangeShape,
  inserted?: { author: MarkAuthor; name: string } | null,
): AuthorMark[] {
  const out: AuthorMark[] = [];
  if (marks.length > 0) {
    changes.iterGaps((posA, posB, length) => {
      const end = posA + length;
      for (const mark of marks) {
        const from = Math.max(mark.from, posA);
        const to = Math.min(mark.to, end);
        if (to > from) out.push({ ...mark, from: posB + (from - posA), to: posB + (to - posA) });
      }
    });
  }
  if (inserted) {
    changes.iterChangedRanges((_fromA, _toA, fromB, toB) => {
      if (toB > fromB) out.push({ author: inserted.author, name: inserted.name, from: fromB, to: toB });
    }, true);
  }
  return normaliseMarks(out);
}

/**
 * The marks moved onto a new version of the text: each run is looked for in
 * the new text and placed at the match nearest where it was. A run that is
 * no longer there is dropped, since it has been rewritten.
 */
export function relocateMarks(oldText: string, marks: readonly AuthorMark[], newText: string): AuthorMark[] {
  const out: AuthorMark[] = [];
  for (const mark of marks) {
    const words = oldText.slice(mark.from, mark.to);
    if (!words.trim()) continue;
    let best = -1;
    for (let at = newText.indexOf(words); at >= 0; at = newText.indexOf(words, at + 1)) {
      if (best < 0 || Math.abs(at - mark.from) < Math.abs(best - mark.from)) best = at;
    }
    if (best >= 0) out.push({ ...mark, from: best, to: best + words.length });
  }
  return normaliseMarks(out, newText.length);
}

/** The marks moved by `by` code units, clipped to `[0, length)`. */
export function shiftMarks(marks: readonly AuthorMark[], by: number, length: number): AuthorMark[] {
  return normaliseMarks(
    marks.map((mark) => ({ ...mark, from: mark.from + by, to: mark.to + by })),
    length,
  );
}

/* ---------- graphemes ---------- */

let segmenter: Intl.Segmenter | null = null;

/** The UTF-16 offset each grapheme of the text starts at. */
export function graphemeStarts(text: string): number[] {
  segmenter ??= new Intl.Segmenter(undefined, { granularity: 'grapheme' });
  const starts: number[] = [];
  for (const segment of segmenter.segment(text)) starts.push(segment.index);
  return starts;
}

/** The grapheme index of a UTF-16 offset; one inside a grapheme counts as the next. */
export function toGrapheme(starts: readonly number[], offset: number): number {
  let lo = 0;
  let hi = starts.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (starts[mid]! < offset) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** The UTF-16 offset a grapheme index starts at; past the end is the end. */
export function toUtf16(starts: readonly number[], grapheme: number, length: number): number {
  return grapheme >= starts.length ? length : starts[Math.max(0, grapheme)]!;
}

/* ---------- SHA-256 ---------- */

// The round constants and first hash: the fractional parts of the cube and
// square roots of the first primes, as FIPS 180-4 defines them.
const PRIMES: number[] = [];
for (let n = 2; PRIMES.length < 64; n += 1) if (PRIMES.every((p) => n % p !== 0)) PRIMES.push(n);
const frac = (x: number) => ((x - Math.floor(x)) * 2 ** 32) >>> 0;
const K = PRIMES.map((p) => frac(Math.cbrt(p)));
const H0 = PRIMES.slice(0, 8).map((p) => frac(Math.sqrt(p)));

const rotr = (x: number, n: number) => (x >>> n) | (x << (32 - n));

/**
 * SHA-256 of the text's UTF-8 bytes, as hex. Written out rather than taken
 * from Web Crypto because the vault save builds the file inside a
 * synchronous rewrite, and node:crypto would not run in the editor.
 */
export function sha256Hex(text: string): string {
  const bytes = new TextEncoder().encode(text);
  const blocks = Math.ceil((bytes.length + 9) / 64);
  const padded = new Uint8Array(blocks * 64);
  padded.set(bytes);
  padded[bytes.length] = 0x80;
  const view = new DataView(padded.buffer);
  const bits = bytes.length * 8;
  view.setUint32(padded.length - 8, Math.floor(bits / 2 ** 32));
  view.setUint32(padded.length - 4, bits >>> 0);

  const h = H0.slice();
  const w = new Uint32Array(64);
  for (let block = 0; block < padded.length; block += 64) {
    for (let i = 0; i < 16; i += 1) w[i] = view.getUint32(block + i * 4);
    for (let i = 16; i < 64; i += 1) {
      const a = w[i - 15]!;
      const b = w[i - 2]!;
      const s0 = rotr(a, 7) ^ rotr(a, 18) ^ (a >>> 3);
      const s1 = rotr(b, 17) ^ rotr(b, 19) ^ (b >>> 10);
      w[i] = (w[i - 16]! + s0 + w[i - 7]! + s1) >>> 0;
    }
    let [a, b, c, d, e, f, g, hh] = h as [number, number, number, number, number, number, number, number];
    for (let i = 0; i < 64; i += 1) {
      const s1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const t1 = (hh + s1 + ch + K[i]! + w[i]!) >>> 0;
      const s0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const t2 = (s0 + maj) >>> 0;
      hh = g;
      g = f;
      f = e;
      e = (d + t1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (t1 + t2) >>> 0;
    }
    const next = [a, b, c, d, e, f, g, hh];
    for (let i = 0; i < 8; i += 1) h[i] = (h[i]! + next[i]!) >>> 0;
  }
  return h.map((x) => x.toString(16).padStart(8, '0')).join('');
}

/* ---------- the block ---------- */

/** A name as it can stand in an author line: one line, no colon, no angle brackets. */
function lineName(name: string): string {
  return name.replace(/[\r\n]+/g, ' ').replace(/:/g, ' -').replace(/[<>]/g, '').replace(/\s+/g, ' ').trim();
}

function rangeList(ranges: readonly { start: number; length: number }[]): string {
  return ranges.map((range) => `${range.start},${range.length}`).join(' ');
}

/**
 * The ranges of the text, in graphemes: the marks as they are, and the
 * person's as everything between them.
 */
export function fileRanges(text: string, marks: readonly AuthorMark[]): FileRange[] {
  const starts = graphemeStarts(text);
  const total = starts.length;
  const ranges: FileRange[] = [];
  let at = 0;
  const self = (to: number) => {
    if (to > at) ranges.push({ author: 'self', start: at, length: to - at, name: '' });
  };
  for (const mark of normaliseMarks(marks, text.length)) {
    const start = toGrapheme(starts, mark.from);
    const end = toGrapheme(starts, mark.to);
    if (end <= start) continue;
    self(start);
    ranges.push({ author: mark.author, start, length: end - start, name: mark.name });
    at = end;
  }
  self(total);
  return ranges;
}

/**
 * The authorship block for `text`, the file before the block with its
 * trailing newlines removed, from the `---` line to the `...` line, with no
 * newline after. `hashText` is the text the hash covers when it differs from
 * `text` only in its line endings: a CRLF is one grapheme, as an LF is, so
 * the offsets hold for both.
 */
export function authorshipBlock(
  text: string,
  marks: readonly AuthorMark[],
  opts: { self: string; hashText?: string },
): { block: string; ranges: FileRange[] } {
  const ranges = fileRanges(text, marks);
  const total = graphemeStarts(text).length;
  const hash = sha256Hex(opts.hashText ?? text).slice(0, HASH_LENGTH);
  const lines = ['---', `Annotations: 0,${total} SHA-256 ${hash}`];

  const groups = new Map<string, FileRange[]>();
  for (const range of ranges) {
    const key =
      range.author === 'self'
        ? `@${lineName(opts.self) || DEFAULT_SELF_NAME}`
        : range.author === 'dash'
          ? `&${DASH_NAME}${lineName(range.name) ? ` <${lineName(range.name)}>` : ''}`
          : `*${lineName(range.name) || 'Quote'}`;
    const group = groups.get(key) ?? [];
    group.push(range);
    groups.set(key, group);
  }
  const order = (key: string) => (key.startsWith('@') ? 0 : key.startsWith('&') ? 1 : 2);
  for (const key of [...groups.keys()].sort((a, b) => order(a) - order(b))) {
    lines.push(`${key}: ${rangeList(groups.get(key)!)}`);
  }
  lines.push('...');
  return { block: lines.join('\n'), ranges };
}

/** One author line of a block as read. */
export type BlockAuthor = { prefix: '@' | '&' | '*'; name: string; id: string | null; ranges: { start: number; length: number }[] };

export type ParsedBlock = {
  /** The file before the block, trailing newlines removed: the text the ranges count in. */
  text: string;
  hash: { start: number; length: number; value: string };
  authors: BlockAuthor[];
};

const HEADER = /^[^:@&*]+:\s*(\d+)(?:,(\d+))?\s+SHA-256\s+([0-9a-fA-F]{20,64})$/;
const AUTHOR = /^([@&*])\s*([^:]*?):\s*(.*)$/;

function lines(text: string): { text: string; start: number }[] {
  const out: { text: string; start: number }[] = [];
  let pos = 0;
  for (;;) {
    const nl = text.indexOf('\n', pos);
    const end = nl < 0 ? text.length : nl;
    out.push({ text: text.slice(pos, end).replace(/\r$/, ''), start: pos });
    if (nl < 0) return out;
    pos = nl + 1;
  }
}

/**
 * The authorship block at the end of a file, read as iA Writer and the
 * Obsidian plugin read it: the last `---` line followed by a header, through
 * a closing `...` line with nothing but blank lines after it. Null when the
 * file has none.
 */
export function readAuthorshipBlock(file: string): ParsedBlock | null {
  const all = lines(file);
  let end = all.length - 1;
  while (end >= 0 && all[end]!.text.trim() === '') end -= 1;
  if (end < 1 || all[end]!.text.trim() !== '...') return null;
  for (let i = end - 2; i >= 0; i -= 1) {
    if (all[i]!.text.trim() !== '---') continue;
    const header = all[i + 1]!.text.trim().match(HEADER);
    if (!header) continue;
    const authors: BlockAuthor[] = [];
    for (const line of all.slice(i + 2, end)) {
      const match = line.text.trim().match(AUTHOR);
      if (!match) continue;
      const label = match[2]!.trim();
      const id = label.match(/<([^>]*)>\s*$/);
      const ranges: { start: number; length: number }[] = [];
      for (const range of match[3]!.matchAll(/(\d+)(?:,(\d+))?/g)) {
        ranges.push({ start: Number(range[1]), length: range[2] === undefined ? 1 : Number(range[2]) });
      }
      authors.push({
        prefix: match[1] as BlockAuthor['prefix'],
        name: id ? label.slice(0, id.index).trim() : label,
        id: id ? id[1]!.trim() : null,
        ranges,
      });
    }
    return {
      text: file.slice(0, all[i]!.start).replace(/(\r?\n)+$/, ''),
      hash: {
        start: Number(header[1]),
        length: header[2] === undefined ? 1 : Number(header[2]),
        value: header[3]!.toLowerCase(),
      },
      authors,
    };
  }
  return null;
}

/** The file without its authorship block, or as it was when it has none. */
export function stripAuthorshipBlock(file: string): string {
  const block = readAuthorshipBlock(file);
  if (!block) return file;
  const eol = file.includes('\r\n') ? '\r\n' : '\n';
  return block.text ? `${block.text}${eol}` : '';
}

/** Whether the text the block annotates is still the text its hash was taken of. */
export function blockMatches(block: ParsedBlock): boolean {
  const starts = graphemeStarts(block.text);
  if (block.hash.start + block.hash.length > starts.length) return false;
  const from = toUtf16(starts, block.hash.start, block.text.length);
  const to = toUtf16(starts, block.hash.start + block.hash.length, block.text.length);
  const hash = sha256Hex(block.text.slice(from, to));
  return hash.slice(0, block.hash.value.length) === block.hash.value;
}

/** The marks a block holds, as UTF-16 ranges of its text: Dash's and quotes; the person's are the rest. */
export function blockMarks(block: ParsedBlock): AuthorMark[] {
  const starts = graphemeStarts(block.text);
  const marks: AuthorMark[] = [];
  for (const author of block.authors) {
    if (author.prefix === '@') continue;
    const kind: MarkAuthor = author.prefix === '&' ? 'dash' : 'quote';
    const name = kind === 'dash' ? (author.id ?? author.name) : author.name;
    for (const range of author.ranges) {
      marks.push({
        author: kind,
        name,
        from: toUtf16(starts, range.start, block.text.length),
        to: toUtf16(starts, range.start + range.length, block.text.length),
      });
    }
  }
  return normaliseMarks(marks, block.text.length);
}

/** The block's ranges as `learn.essays.authorship` keeps them. */
export function blockRanges(block: ParsedBlock): FileRange[] {
  const ranges: FileRange[] = [];
  for (const author of block.authors) {
    const kind: FileRange['author'] = author.prefix === '@' ? 'self' : author.prefix === '&' ? 'dash' : 'quote';
    const name = kind === 'self' ? '' : kind === 'dash' ? (author.id ?? author.name) : author.name;
    for (const range of author.ranges) ranges.push({ author: kind, start: range.start, length: range.length, name });
  }
  return ranges.sort((a, b) => a.start - b.start);
}

/* ---------- your words ---------- */

const COUNTED = /[\p{L}\p{N}]/u;

/** What "your words" says, and the rule it is written beside. */
export const YOUR_WORDS_RULE =
  'Letters and digits you wrote, out of yours and Dash’s. Quotes, spaces and markdown symbols are left out.';

/**
 * The letters and digits that are the person's and that are Dash's, quotes
 * left out of both, and the person's share of the two as a whole percentage
 * (null when there is nothing to count).
 */
export function yourWords(text: string, marks: readonly AuthorMark[]): { yours: number; dash: number; percent: number | null } {
  segmenter ??= new Intl.Segmenter(undefined, { granularity: 'grapheme' });
  const sorted = normaliseMarks(marks, text.length);
  let yours = 0;
  let dash = 0;
  let at = 0;
  for (const { segment, index } of segmenter.segment(text)) {
    if (!COUNTED.test(segment)) continue;
    while (at < sorted.length && sorted[at]!.to <= index) at += 1;
    const mark = sorted[at];
    const author = mark && mark.from <= index ? mark.author : null;
    if (author === 'dash') dash += 1;
    else if (author === null) yours += 1;
  }
  const total = yours + dash;
  // Floored, so a single accepted word in a long essay never rounds you to 100%.
  const percent = total === 0 ? null : dash === 0 ? 100 : Math.min(99, Math.floor((yours / total) * 100));
  return { yours, dash, percent };
}
