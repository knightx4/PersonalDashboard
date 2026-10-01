import { wallClockToInstant } from '@/lib/todo/time';
import { money } from '@/lib/watch/format';
import { reportTimeLabel } from '@/lib/shell/watching-model';
import type { DashChangeInput } from '@/lib/talk/changes';

/**
 * Starting a watch from what Dash was asked (plan #1296): the pure half.
 *
 * `parseWatchRequest` turns the arguments of Ask Dash's propose_watch into
 * the core.watches row a confirm will insert, refusing in a sentence the
 * model can say back what the table or the hourly run would not take.
 * `watchPlan` and `noPushLine` are how the proposal reads, to the model and
 * on the card. No server imports, so the card can use them.
 */

export type StartWatch = DashChangeInput['start_watch'];

/** As many report times as core.watches takes (watches_report_times_ck). */
export const MAX_REPORT_TIMES = 6;
/** How far ahead a watch may end: a season of resale, not a standing order. */
export const MAX_WATCH_DAYS = 180;

/** Where push is switched on, for the line that says it is off. */
export const PUSH_SETTINGS_HREF = '/account#notifications';

type Parsed = { ok: true; value: Omit<StartWatch, 'goalItemId' | 'goalTitle' | 'pushOn'> } | { ok: false; error: string };

function text(args: Record<string, unknown>, key: string): string {
  const value = args[key];
  return typeof value === 'string' ? value.trim() : '';
}

/** "9:00", "09:00" or "21:30" as "HH:MM"; null when it is not a time of day. */
export function clockOf(raw: string): string | null {
  const match = /^(\d{1,2}):(\d{2})(?::00)?$/.exec(raw.trim());
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || minute > 59) return null;
  return `${String(hour).padStart(2, '0')}:${match[2]}`;
}

function isDay(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const at = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(at.getTime()) && at.toISOString().slice(0, 10) === value;
}

/**
 * Check what Dash proposes to watch. `now` and `timezone` place the end: the
 * watch ends at `ends_time` (23:59 when none was said) on `ends_on`, in the
 * person's zone, which is also the zone report times are read in.
 */
export function parseWatchRequest(
  args: Record<string, unknown>,
  { now, timezone }: { now: Date; timezone: string },
): Parsed {
  const title = text(args, 'title').replace(/\s+/g, ' ');
  if (!title) return { ok: false, error: 'Give the watch a title: what is being watched, in a few words.' };
  if (title.length > 200) return { ok: false, error: 'The title is longer than 200 characters.' };

  const rawUrl = text(args, 'url');
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return { ok: false, error: 'url is not a web address. Ask them for the link to the page to watch.' };
  }
  if (url.protocol !== 'https:') return { ok: false, error: 'Only an https page can be watched.' };
  if (url.username || url.password) return { ok: false, error: 'That address carries a login, so it cannot be watched.' };
  if (url.toString().length > 2000) return { ok: false, error: 'That address is longer than 2000 characters.' };

  let below: number | null = null;
  if (args.below !== undefined && args.below !== null) {
    const n = Number(args.below);
    if (!Number.isFinite(n) || n <= 0) return { ok: false, error: 'below has to be a price above zero.' };
    below = Math.round(n * 100) / 100;
  }

  const currencyRaw = text(args, 'currency').toUpperCase();
  if (currencyRaw && !/^[A-Z]{3}$/.test(currencyRaw)) {
    return { ok: false, error: 'currency has to be a three-letter code, such as USD.' };
  }
  const currency = currencyRaw || null;

  const rawTimes = Array.isArray(args.report_times) ? args.report_times : [];
  const reportTimes: string[] = [];
  for (const raw of rawTimes) {
    const clock = typeof raw === 'string' ? clockOf(raw) : null;
    if (!clock) return { ok: false, error: `${String(raw)} is not a time of day. Write report times as HH:MM.` };
    if (!reportTimes.includes(clock)) reportTimes.push(clock);
  }
  if (reportTimes.length > MAX_REPORT_TIMES) {
    return { ok: false, error: `A watch takes at most ${MAX_REPORT_TIMES} report times.` };
  }
  reportTimes.sort();

  if (below === null && reportTimes.length === 0) {
    return {
      ok: false,
      error: 'A watch needs a price to go under, report times, or both, or it would never tell them anything. Ask which they want.',
    };
  }

  const endsOn = text(args, 'ends_on');
  if (!isDay(endsOn)) return { ok: false, error: 'ends_on has to be a day, YYYY-MM-DD. Ask when it should stop if they did not say.' };
  const endsTimeRaw = text(args, 'ends_time');
  const endsTime = endsTimeRaw ? clockOf(endsTimeRaw) : '23:59';
  if (!endsTime) return { ok: false, error: 'ends_time has to be a time of day, HH:MM.' };
  const endsAt = wallClockToInstant(endsOn, endsTime, timezone);
  const endsMs = Date.parse(endsAt);
  if (!(endsMs > now.getTime())) return { ok: false, error: 'That end is already past. A watch has to end later than now.' };
  if (endsMs - now.getTime() > MAX_WATCH_DAYS * 86_400_000) {
    return { ok: false, error: `A watch can run for at most ${MAX_WATCH_DAYS} days.` };
  }

  return {
    ok: true,
    value: { title, url: url.toString(), below, currency, reportTimes, endsAt, endsOn },
  };
}

function listed(parts: readonly string[]): string {
  if (parts.length <= 1) return parts.join('');
  return `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
}

/**
 * What the watch will do, after its title: ", pushing you when it goes under
 * $200 and reporting at 9:00 AM, until 4 Oct". `endsLabel` is the end as the
 * caller writes a day.
 */
export function watchPlan(watch: Pick<StartWatch, 'below' | 'currency' | 'reportTimes'>, endsLabel: string): string {
  const parts: string[] = [];
  if (watch.below !== null) parts.push(`a push when it goes under ${money(watch.below, watch.currency)}`);
  if (watch.reportTimes.length > 0) parts.push(`a report at ${listed(watch.reportTimes.map(reportTimeLabel))}`);
  return `, with ${parts.join(' and ')}, until ${endsLabel}`;
}

/** Said when no device has push on: the watch still runs and shows on the home page. */
export const NO_PUSH =
  'No device has push switched on, so the watch will show on the home page but nothing will reach your phone.';
/** And how to switch it on. */
export const PUSH_HOW = 'Switch push on in Account, under Notifications, on your phone.';
export const NO_PUSH_LINE = `${NO_PUSH} ${PUSH_HOW}`;
