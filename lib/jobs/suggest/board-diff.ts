/**
 * The rules of the daily board read (plan #2535.3), kept pure so they are
 * tested without fetching. The reading and writing are board-watch.ts.
 *
 * Each followed board is read once a day, and what it showed is compared with
 * what the earlier reads kept in job_search.board_postings: a posting not
 * seen before is new, one seen before is still up, and one the board no
 * longer shows has been taken down. A board's first read has nothing to
 * compare with, so everything on it is recorded as already seen and none of
 * it is suggested, which keeps the first day from flooding the list.
 */

import { isTimeZone, whenDate } from '@/lib/core/when';
import { possessive } from '@/lib/jobs/ats/portfolio-parse';

/** A board is read again this long after its last try: once a day, with slack for the ten-minute cron. */
export const READ_EVERY_HOURS = 20;
/** The pick of new postings asks Dash at most this often. */
export const PICK_EVERY_HOURS = 20;

const HOUR_MS = 60 * 60 * 1000;

/**
 * The key a posting is kept under: its link without the fragment, the trailing
 * slash or the host's case, so the same posting read twice is one row. The
 * query string stays, since some boards name the posting there.
 */
export function postingKey(url: string): string {
  try {
    const parsed = new URL(url.trim());
    parsed.hash = '';
    parsed.hostname = parsed.hostname.toLowerCase();
    const path = parsed.pathname.replace(/\/+$/, '');
    return `${parsed.protocol}//${parsed.host}${path}${parsed.search}`;
  } catch {
    return url.trim();
  }
}

export type ReadPosting = { title: string; url: string; location: string | null };
export type StoredPosting = { postingKey: string; goneAt: string | null };

export type BoardDiff = {
  /** Postings to insert; `offered` is true on a first read, so they never go to a pick. */
  added: (ReadPosting & { postingKey: string; offered: boolean })[];
  /** Keys the board still shows, kept before. */
  seen: string[];
  /** Keys kept before and up at the last read that the board no longer shows. */
  gone: string[];
};

export function diffBoard(stored: readonly StoredPosting[], read: readonly ReadPosting[], firstRead: boolean): BoardDiff {
  const known = new Map(stored.map((row) => [row.postingKey, row]));
  const shown = new Set<string>();
  const added: BoardDiff['added'] = [];
  const seen: string[] = [];
  for (const posting of read) {
    if (!posting.url || !posting.title) continue;
    const key = postingKey(posting.url);
    if (shown.has(key)) continue;
    shown.add(key);
    if (known.has(key)) seen.push(key);
    else added.push({ ...posting, postingKey: key, offered: firstRead });
  }
  const gone = stored.filter((row) => !row.goneAt && !shown.has(row.postingKey)).map((row) => row.postingKey);
  return { added, seen, gone };
}

/** The time before which a board is due for its daily read. */
export function readCutoff(now: Date): string {
  return new Date(now.getTime() - READ_EVERY_HOURS * HOUR_MS).toISOString();
}

/** Whether the day's pick may ask Dash: never asked, or not within PICK_EVERY_HOURS. */
export function pickDue(pickedAt: string | null, now: Date): boolean {
  if (!pickedAt) return true;
  return now.getTime() - new Date(pickedAt).getTime() >= PICK_EVERY_HOURS * HOUR_MS;
}

/** The found-in line of a role the pick suggests: "New on Clay's board, first seen 24 Oct". */
export function newOnBoardLine(company: string, firstSeenAt: string, timeZone = 'UTC'): string {
  const zone = isTimeZone(timeZone) ? timeZone : 'UTC';
  return `New on ${company}'s board, first seen ${whenDate(firstSeenAt, { timeZone: zone, year: 'never' })}`;
}

/** The found-in line of a role from an investor's portfolio board (plan #2535.4): "New on RRE Ventures' portfolio board, first seen 24 Oct". */
export function newOnPortfolioLine(investor: string, firstSeenAt: string, timeZone = 'UTC'): string {
  const zone = isTimeZone(timeZone) ? timeZone : 'UTC';
  return `New on ${possessive(investor)} portfolio board, first seen ${whenDate(firstSeenAt, { timeZone: zone, year: 'never' })}`;
}
