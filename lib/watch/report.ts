/**
 * The trend report a watch sends at the times set on it (plan #1294).
 *
 * `report_times` are times of day in the person's own zone. The hourly run
 * (lib/watch/run.ts) asks `reportSlot` whether one of them passed within the
 * last REPORT_WINDOW_MINUTES and has not been reported since, and when it has
 * sends `reportPayload`: which way the price has moved since the watch
 * started, the low so far, what is listed and the best offer, and whether
 * waiting has paid. The same title and body are kept on that hour's reading
 * as detail.report, which the home page's Watching row reads (#1295).
 *
 * The window is wider than the hour so a run that starts a minute late still
 * sends; reported_at stops the next run sending the same time twice.
 *
 * Pure: the readings and the clock come in as arguments.
 */

import { BODY_MAX, clip, TITLE_MAX } from '@/lib/day-brief/notification';
import type { PushPayload } from '@/lib/push/send';
import type { PriceDetail } from '@/lib/watch/parse-price';
import { money, WATCH_URL } from '@/lib/watch/format';
import type { WatchRow } from '@/lib/watch/run';

/** How long after a report time the run still sends it. */
export const REPORT_WINDOW_MINUTES = 90;

/** What the reading's detail.report holds, and what the push says. */
export type WatchReport = { title: string; body: string };

/** One reading that found a value, oldest first in the lists below. */
export type ValuePoint = { value: number; taken_at: string };

function minuteOfDay(timezone: string, now: Date): number {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: timezone,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(now);
  const get = (type: string) => Number(parts.find((part) => part.type === type)?.value ?? '0');
  return get('hour') * 60 + get('minute');
}

/** "09:00" or "09:00:00" as minutes after midnight; null when unreadable. */
function timeMinutes(time: string): number | null {
  const match = /^(\d{1,2}):(\d{2})/.exec(time);
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  return hour < 24 && minute < 60 ? hour * 60 + minute : null;
}

/**
 * The report time due at `now`, as the instant it fell at, or null. Due means
 * it passed within the window and nothing was reported at or after it. When
 * two are due, the later one is the one sent.
 */
export function reportSlot(
  watch: Pick<WatchRow, 'report_times' | 'reported_at'>,
  timezone: string,
  now: Date,
): Date | null {
  const nowMinute = minuteOfDay(timezone, now);
  const reported = watch.reported_at ? Date.parse(watch.reported_at) : null;
  let due: Date | null = null;
  for (const time of watch.report_times) {
    const minutes = timeMinutes(time);
    if (minutes === null) continue;
    const since = (nowMinute - minutes + 1440) % 1440;
    if (since >= REPORT_WINDOW_MINUTES) continue;
    const at = new Date(Math.floor(now.getTime() / 60_000) * 60_000 - since * 60_000);
    if (reported !== null && reported >= at.getTime()) continue;
    if (!due || at > due) due = at;
  }
  return due;
}

/** "Down $24", "Up $12", "No change": the move from the first value to the latest. */
function direction(first: number, latest: number, currency: string): string {
  if (latest < first) return `Down ${money(round(first - latest), currency)}`;
  if (latest > first) return `Up ${money(round(latest - first), currency)}`;
  return 'No change';
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * The report from every value the watch has read, oldest first, and the
 * detail of the latest reading when it worked. Null when the watch has never
 * read a value, since there is no trend to report.
 */
export function buildReport(
  watch: Pick<WatchRow, 'title' | 'condition'>,
  points: readonly ValuePoint[],
  latest: { detail: PriceDetail } | { error: string },
): WatchReport | null {
  if (points.length === 0) return null;
  const detail = 'detail' in latest ? latest.detail : null;
  const currency = detail?.currency || watch.condition.currency || 'USD';
  const first = points[0]!.value;
  const last = points[points.length - 1]!.value;
  const low = Math.min(...points.map((point) => point.value));

  const title = `${direction(first, last, currency)}: ${watch.title}`;
  const parts: string[] = [];
  parts.push(
    last === first
      ? `Cheapest is ${money(last, currency)}, the same as when the watch started.`
      : `Cheapest is ${money(last, currency)}, from ${money(first, currency)} when the watch started.`,
  );
  if (low < last) parts.push(`Low so far ${money(low, currency)}.`);

  const listed: string[] = [];
  if (detail?.listings) listed.push(`${detail.listings} ${detail.listings === 1 ? 'listing' : 'listings'}`);
  if (detail?.top_offer) listed.push(`top offer ${money(detail.top_offer, currency)}`);
  if (listed.length) parts.push(`${listed.join(', ')}.`.replace(/^./, (c) => c.toUpperCase()));

  if (points.length === 1) parts.push('Too early to say whether waiting pays.');
  else if (last < first && last <= low) parts.push('Still at its low, so waiting has paid so far.');
  else if (last < first) parts.push('Off its low, so waiting has paid less than it did.');
  else if (last > first) parts.push('Waiting has not paid so far.');
  else parts.push('Nothing gained or lost by waiting yet.');

  if (!detail) parts.push('The latest check could not read the page.');

  return { title: clip(title, TITLE_MAX), body: clip(parts.join(' '), BODY_MAX) };
}

export function reportPayload(watch: Pick<WatchRow, 'id'>, report: WatchReport): PushPayload {
  return { title: report.title, body: report.body, url: WATCH_URL, tag: `watch-${watch.id}-report` };
}
