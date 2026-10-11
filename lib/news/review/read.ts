import { assertSchemaExposed } from '@/lib/core/db/schema-errors';
import { formatClock } from '@/lib/clock';
import { safeTimeZone } from '@/lib/core/timezone';
import { NEWS_SCHEMA, type NewsSupabaseClient } from '@/lib/news/db/schema-name';
import type { ReviewItem } from './choose';
import { REVIEW_HOUR, reviewClock } from './run';

/**
 * Reading the daily reviews back for the Daily review tab (plan #1616, under
 * #1612).
 *
 * The cron (#1615) writes one row per day into news.daily_reviews. The tab
 * shows one day at a time, the latest unless the address names another as
 * `?day=`, with arrows to the day before and after that has a row. So it
 * reads two things: which days have a row, and the one row it shows.
 *
 * A row with an error and no overview is an evening whose run failed. The
 * error is the raw message, kept for whoever fixes it, so the tab says the
 * review could not be written in its own words and never shows the string.
 */

/** A day as the table keys it: `YYYY-MM-DD`, in the person's own timezone. */
const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** The most days the arrows reach back through: well over a year of evenings. */
const DAYS_READ = 500;

/** One day's review as the tab draws it. `overview` is null when the run failed. */
export type DailyReview = {
  day: string;
  overview: string | null;
  items: ReviewItem[];
  writtenAt: string;
};

/** A `?day=` value the tab can look up, or null for anything else. */
export function readReviewDay(value: string | undefined): string | null {
  if (!value || !DAY.test(value)) return null;
  const date = new Date(`${value}T12:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value
    ? value
    : null;
}

/**
 * The stored items, checked one by one. An entry missing what a line needs
 * (where it opens, and the line itself) is left out rather than drawn as a
 * line that goes nowhere.
 */
export function readReviewItems(value: unknown): ReviewItem[] {
  if (!Array.isArray(value)) return [];
  const items: ReviewItem[] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== 'object') continue;
    const { issue_id, story_index, headline, line, sources, local } = entry as Record<
      string,
      unknown
    >;
    if (typeof issue_id !== 'string' || !issue_id) continue;
    if (typeof story_index !== 'number' || !Number.isInteger(story_index) || story_index < 0) {
      continue;
    }
    if (typeof line !== 'string' || !line.trim()) continue;
    items.push({
      issue_id,
      story_index,
      headline: typeof headline === 'string' ? headline.trim() : '',
      line: line.trim(),
      sources: typeof sources === 'number' && sources >= 1 ? Math.floor(sources) : 1,
      ...(local === true && { local: true as const }),
    });
  }
  return items;
}

/**
 * The day shown, and the days either side of it that have a review.
 *
 * `days` are newest first. A `wanted` day with no row falls back to the
 * latest, so an old link to a day that had no newsletters still opens the
 * tab on something.
 */
export function reviewNav(
  days: readonly string[],
  wanted: string | null,
): { day: string | null; earlier: string | null; later: string | null } {
  if (days.length === 0) return { day: null, earlier: null, later: null };
  const at = wanted ? days.indexOf(wanted) : -1;
  const i = at >= 0 ? at : 0;
  return { day: days[i]!, earlier: days[i + 1] ?? null, later: i > 0 ? days[i - 1]! : null };
}

/** The tab's address for one day; the latest day is the bare address. */
export function reviewHref(day: string | null, latest: string | null): string {
  return day && day !== latest ? `/news/review?day=${day}` : '/news/review';
}

/** "Tuesday 6 October", with the year when it is not this year's. */
export function reviewDayLabel(day: string, now: Date = new Date()): string {
  const date = new Date(`${day}T12:00:00Z`);
  // Put together from the parts, since ICU versions differ on a comma after the weekday.
  const part = (options: Intl.DateTimeFormatOptions) =>
    new Intl.DateTimeFormat('en-GB', { ...options, timeZone: 'UTC' }).format(date);
  const label = `${part({ weekday: 'long' })} ${date.getUTCDate()} ${part({ month: 'long' })}`;
  return date.getUTCFullYear() === now.getUTCFullYear()
    ? label
    : `${label} ${date.getUTCFullYear()}`;
}

/** "Mon 5 Oct", for the arrows. */
export function reviewDayShort(day: string): string {
  const date = new Date(`${day}T12:00:00Z`);
  const part = (options: Intl.DateTimeFormatOptions) =>
    new Intl.DateTimeFormat('en-GB', { ...options, timeZone: 'UTC' }).format(date);
  return `${part({ weekday: 'short' })} ${date.getUTCDate()} ${part({ month: 'short' })}`;
}

/** The hour the review is written, as the page says it: "8:00 PM". */
export const REVIEW_TIME = formatClock(Date.UTC(2000, 0, 1, REVIEW_HOUR), { timeZone: 'UTC' });

/**
 * Whether today's review is still to come: before 8pm in the person's zone,
 * the latest review is yesterday's or older, and the tab says when today's
 * is written.
 */
export function todayStillToCome(timezone: string, now: Date = new Date()): boolean {
  return reviewClock(safeTimeZone(timezone), now) === null;
}

/** The days that have a review, newest first. */
export async function loadReviewDays(client: NewsSupabaseClient): Promise<string[]> {
  const { data, error } = await client
    .from('daily_reviews')
    .select('day')
    .order('day', { ascending: false })
    .limit(DAYS_READ);
  assertSchemaExposed(error, NEWS_SCHEMA);
  if (error) throw new Error(`news: reading the daily reviews failed (${error.message})`);
  return ((data ?? []) as { day: string }[]).map((row) => row.day);
}

/** One day's review, or null when that day has none. */
export async function loadReview(
  client: NewsSupabaseClient,
  day: string,
): Promise<DailyReview | null> {
  const { data, error } = await client
    .from('daily_reviews')
    .select('day, overview, items, written_at, error')
    .eq('day', day)
    .maybeSingle();
  assertSchemaExposed(error, NEWS_SCHEMA);
  if (error) throw new Error(`news: reading the review for ${day} failed (${error.message})`);
  if (!data) return null;
  const row = data as {
    day: string;
    overview: string | null;
    items: unknown;
    written_at: string;
  };
  const overview = row.overview?.trim() || null;
  return {
    day: row.day,
    overview,
    items: overview ? readReviewItems(row.items) : [],
    writtenAt: row.written_at,
  };
}
