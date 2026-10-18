/**
 * When a vault note was first written (plan #2413.2).
 *
 * created_at is the day the app first saw a note, which for almost the whole
 * vault is the first sync. The evidence for the real day is in five places,
 * and each says "written no later than this":
 *
 *   git_first_commit  the first commit that added the file at its path
 *   filename          a YYYY-MM-DD in the file's name
 *   body              a line or heading that is a date, opening an entry
 *   frontmatter       a created or date property
 *   image_name        a pasted image named like 20230517222850.png
 *
 * So the earliest wins. A date later than `now` is a plan or a due date, not
 * evidence, and is dropped; so is one before EARLIEST_PLAUSIBLE, which in a
 * note is history being written about.
 *
 * Dates with no time of day are midnight UTC. Pasted-image timestamps are
 * Obsidian's local time with no zone, and are read as UTC too: a few hours
 * either way does not change what came before what.
 *
 * Pure: everything is passed in, so each source and the rule between them are
 * tested without a database (first-written.test.ts).
 */

export type FirstWrittenSource = 'git_first_commit' | 'filename' | 'body' | 'frontmatter' | 'image_name';

/**
 * One dated entry inside a note. `offset` and `end` count code points of the
 * body, not UTF-16 units, so SQL's substr(body, offset + 1, end - offset)
 * reads the same entry as readDatedEntries does.
 */
export type DatedEntry = { date: string; offset: number; end: number };

export type FirstWritten = {
  at: string | null;
  source: FirstWrittenSource | null;
  entries: DatedEntry[];
};

export const EARLIEST_PLAUSIBLE = '1990-01-01';

/** Frontmatter keys that say when a note was made, in the order people use them. */
const CREATED_KEYS = ['created', 'date-created', 'date_created', 'created_at', 'creation date', 'date'];

/** When evidence of two kinds gives the same instant, the more exact one is named. */
const SOURCE_ORDER: readonly FirstWrittenSource[] = [
  'git_first_commit',
  'image_name',
  'frontmatter',
  'filename',
  'body',
];

/** YYYY-MM-DD, or with dots or slashes, as a valid calendar day. */
function calendarDay(year: string, month: string, day: string): string | null {
  const y = Number(year);
  const m = Number(month);
  const d = Number(day);
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  const date = new Date(Date.UTC(y, m - 1, d));
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) return null;
  return `${year}-${month}-${day}`;
}

function plausible(iso: string, now: Date): boolean {
  const t = Date.parse(iso);
  return Number.isFinite(t) && t >= Date.parse(EARLIEST_PLAUSIBLE) && t <= now.getTime();
}

function dayToIso(day: string): string {
  return `${day}T00:00:00.000Z`;
}

/** The date in a file's own name, ignoring the folders it sits in. */
export function filenameDate(path: string, now: Date): string | null {
  const base = path.split('/').pop() ?? path;
  const match = /(?<!\d)(\d{4})-(\d{2})-(\d{2})(?!\d)/.exec(base);
  if (!match) return null;
  const day = calendarDay(match[1], match[2], match[3]);
  if (!day) return null;
  const iso = dayToIso(day);
  return plausible(iso, now) ? iso : null;
}

/** The earliest created-like date in the note's properties. */
export function frontmatterDate(frontmatter: Record<string, unknown>, now: Date): string | null {
  let earliest: string | null = null;
  for (const key of CREATED_KEYS) {
    const value = frontmatter[key];
    let iso: string | null = null;
    if (value instanceof Date) iso = Number.isNaN(value.getTime()) ? null : value.toISOString();
    else if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}/.test(value.trim())) {
      const parsed = new Date(value.trim());
      iso = Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
    }
    if (iso && plausible(iso, now) && (!earliest || iso < earliest)) earliest = iso;
  }
  return earliest;
}

const IMAGE_STAMP =
  /(?<!\d)(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})(?!\d)[^\]\)\n]*?\.(?:png|jpe?g|gif|webp|bmp|heic|svg)\b/gi;

/** The earliest timestamp in the name of an image the note embeds or links. */
export function imageNameDate(body: string, now: Date): string | null {
  let earliest: string | null = null;
  for (const match of body.matchAll(IMAGE_STAMP)) {
    const day = calendarDay(match[1], match[2], match[3]);
    const [h, mi, s] = [Number(match[4]), Number(match[5]), Number(match[6])];
    if (!day || h > 23 || mi > 59 || s > 59) continue;
    const iso = `${day}T${match[4]}:${match[5]}:${match[6]}.000Z`;
    if (plausible(iso, now) && (!earliest || iso < earliest)) earliest = iso;
  }
  return earliest;
}

/**
 * A line that opens an entry: the date alone, perhaps as a link to a daily
 * note or behind heading marks, or a heading that starts with one
 * ("## 2024-02-17 Camp house"). A date in the middle of a sentence, or a link
 * to a note whose name merely starts with a date, opens nothing.
 */
const DATE_LINE =
  /^(?:(#{1,6})\s+)?(?:\[\[)?(\d{4})[-./](\d{2})[-./](\d{2})(?:\]\])?\s*(.*)$/;

const HEADING = /^#{1,6}\s/;

/** Text of an entry with links, headings and whitespace taken out. */
function hasProse(text: string): boolean {
  return text.replace(/!?\[\[[^\]]*\]\]/g, '').replace(/\s+/g, '').length > 0;
}

/**
 * The dated entries in a body, in the order they appear. An entry runs from
 * its date line to the next date line or heading, and one with no prose of
 * its own (a list of links to daily notes) is not an entry.
 */
export function datedEntries(body: string, now: Date): DatedEntry[] {
  type Open = { date: string; start: number; textStart: number };
  const found: Array<{ date: string; start: number; end: number; textStart: number }> = [];
  let open: Open | null = null;
  let pos = 0;

  const close = (end: number) => {
    if (open) found.push({ ...open, end });
    open = null;
  };

  for (const line of body.split('\n')) {
    const lineStart = pos;
    pos += line.length + 1;
    const trimmed = line.trim();
    const match = DATE_LINE.exec(trimmed);
    const day = match ? calendarDay(match[2], match[3], match[4]) : null;
    // Trailing text after the date only belongs to a heading; on a bare line
    // it is a sentence that happens to start with a date.
    const opens = match && day && (match[1] || match[5] === '') && plausible(dayToIso(day), now);

    if (opens) {
      close(lineStart);
      open = { date: day, start: lineStart, textStart: pos };
    } else if (HEADING.test(trimmed)) {
      close(lineStart);
    }
  }
  close(body.length);

  // Code points, so the offsets mean the same in Postgres.
  const toPoints = (index: number) => Array.from(body.slice(0, index)).length;

  return found
    .filter((entry) => hasProse(body.slice(Math.min(entry.textStart, entry.end), entry.end)))
    .map((entry) => {
      // The blank lines before the next entry are not part of this one.
      let end = entry.end;
      while (end > entry.start && /\s/.test(body[end - 1])) end -= 1;
      return { date: entry.date, offset: toPoints(entry.start), end: toPoints(end) };
    });
}

/** Each dated entry with its text, the date line included. */
export function readDatedEntries(body: string, entries: readonly DatedEntry[]): Array<{ date: string; text: string }> {
  const points = Array.from(body);
  return entries.map((entry) => ({
    date: entry.date,
    text: points.slice(entry.offset, entry.end).join(''),
  }));
}

/**
 * The earliest evidence of when a note was written, and its dated entries.
 * `gitFirstCommitAt` is null when it has not been looked up or GitHub had no
 * commit for the path.
 */
export function firstWritten(input: {
  path: string;
  body: string;
  frontmatter: Record<string, unknown>;
  gitFirstCommitAt: string | null;
  now: Date;
}): FirstWritten {
  const { path, body, frontmatter, now } = input;
  const entries = datedEntries(body, now);

  const candidates: Array<{ at: string; source: FirstWrittenSource }> = [];
  const push = (at: string | null, source: FirstWrittenSource) => {
    if (at && plausible(at, now)) candidates.push({ at: new Date(at).toISOString(), source });
  };

  push(input.gitFirstCommitAt, 'git_first_commit');
  push(filenameDate(path, now), 'filename');
  const earliestEntry = entries.reduce<string | null>(
    (min, entry) => (!min || entry.date < min ? entry.date : min),
    null,
  );
  push(earliestEntry ? dayToIso(earliestEntry) : null, 'body');
  push(frontmatterDate(frontmatter, now), 'frontmatter');
  push(imageNameDate(body, now), 'image_name');

  if (!candidates.length) return { at: null, source: null, entries };

  candidates.sort(
    (a, b) => a.at.localeCompare(b.at) || SOURCE_ORDER.indexOf(a.source) - SOURCE_ORDER.indexOf(b.source),
  );
  return { at: candidates[0].at, source: candidates[0].source, entries };
}
