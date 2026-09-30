import { BRIEF_ANCHOR } from './shown';

/**
 * Recording which briefs and picks are opened (plan #1242).
 *
 * The notification opens /home?brief=<day>#brief, and the service worker adds
 * from=push when it opens that URL (public/sw.js), so only a press on the
 * notification carries both. The home page then stamps opened_at on that
 * day's brief through core.open_day_brief. Following a pick's link stamps
 * that pick through core.open_day_brief_pick (app/home/actions.ts). Both
 * functions stamp once; supabase/migrations/0130_day_brief_opens.sql.
 *
 * Opening the home page any other way records nothing. Nothing reads the
 * record yet: it is kept so the order of kinds can be checked later against
 * what is actually opened.
 */

/** The query parameter carrying the day the notification was for. */
export const BRIEF_DAY_PARAM = 'brief';

/** The parameter and value the service worker adds when it opens a URL. */
export const FROM_PARAM = 'from';
export const FROM_PUSH = 'push';

const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** A calendar day as YYYY-MM-DD that exists. */
export function isDay(value: unknown): value is string {
  if (typeof value !== 'string' || !DAY.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

/** Where the day's notification opens: the brief on the home page, marked with its day. */
export function briefUrl(day: string): string {
  return `/home?${BRIEF_DAY_PARAM}=${encodeURIComponent(day)}#${BRIEF_ANCHOR}`;
}

type SearchParams = Record<string, string | string[] | undefined>;

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/**
 * The day whose brief this visit opened from the notification, or null when
 * the page was opened any other way. A notification sent before the day was
 * put in its URL carries only from=push, and counts for today.
 */
export function openedFromPush(params: SearchParams, today: string): string | null {
  if (first(params[FROM_PARAM]) !== FROM_PUSH) return null;
  const day = first(params[BRIEF_DAY_PARAM]);
  if (day === undefined) return today;
  return isDay(day) ? day : null;
}

/**
 * Something that could be a pick's key (`task:<id>`, `bill:<id>`, and so on).
 * Only checked for shape: the database stamps nothing unless a pick on the
 * caller's own brief has exactly this key.
 */
export function isPickKey(value: unknown): value is string {
  return typeof value === 'string' && value.trim() !== '' && value.length <= 300;
}
