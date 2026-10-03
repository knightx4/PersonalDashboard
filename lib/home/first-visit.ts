/**
 * Home's first visit of the day (plan #1558, docs/UI-QUALITY-SPEC.md Part 8).
 *
 * PURE. Two cookies, each holding the last day (in the account's timezone) on
 * which Home showed something: `home_arrived` for the morning sequence, and
 * `home_sigil` for the day's sigil drawing in beside the date. The page reads
 * them on the server, so the first byte of HTML already says whether to play,
 * and a page that should not play is never drawn in its starting state. The
 * browser writes today's date back once the page is up (SeenToday in
 * app/home/arrival.tsx), so the next visit that day arrives at rest.
 *
 * A cookie rather than browser storage because the server has to know before
 * it renders: storage is only readable after the page has painted, by which
 * time a sequence that starts from nothing would flash.
 */

import type { CSSProperties } from 'react';

export const HOME_ARRIVED_COOKIE = 'home_arrived';
export const HOME_SIGIL_COOKIE = 'home_sigil';

/** Two days, so a cookie from yesterday is still there to compare against. */
const MAX_AGE_SECONDS = 2 * 24 * 60 * 60;

/** Whether `day` is a day the cookie has not seen yet. A missing or garbled cookie has seen nothing. */
export function firstToday(seen: string | undefined | null, day: string): boolean {
  return seen !== day;
}

/** The `document.cookie` assignment that records `day` under `name`. */
export function seenCookie(name: string, day: string): string {
  return `${name}=${encodeURIComponent(day)}; path=/; max-age=${MAX_AGE_SECONDS}; samesite=lax`;
}

/**
 * The morning sequence's last step: the greeting is 0, the date 1, the brief
 * 2 and the rest of the column 3. Its end is the sequence's end.
 */
export const ARRIVE_LAST_STEP = 3;

/** A part of the morning sequence's place in it, as `home-arrive` in app/globals.css reads it. */
export function arriveAt(step: number): CSSProperties {
  return { '--arrive': String(step) } as CSSProperties;
}
