import { formatClock } from '@/lib/clock';
import { money } from '@/lib/watch/format';
import type { Update } from '@/lib/shell/home-model';

/**
 * The pure half of the home page's Watching section (plan #1295): how a
 * running watch is described on its row, and how one that ended is said in
 * Updates. The reads are in watching.ts next door.
 */

/** One running watch, as its row shows it. */
export interface WatchingRow {
  id: string;
  title: string;
  url: string;
  /** The latest value read, and the first, in `currency`. Null before any read worked. */
  latest: number | null;
  first: number | null;
  /** How many readings found a value; the direction needs two. */
  readings: number;
  currency: string;
  /** When the newest reading was taken, whether it worked or not. */
  checkedAt: string | null;
  /** Why the newest reading failed; null when it worked or there is none. */
  failing: string | null;
  below: number | null;
  fired: { value: number; at: string } | null;
  reportTimes: string[];
  endsAt: string;
  goal: { title: string; href: string } | null;
  /** The last report sent, from detail.report on the reading it went out with (#1294). */
  report: { title: string; body: string; at: string } | null;
}

export type Direction = { text: string; tone: 'down' | 'up' | 'flat' };

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * Which way the price has gone since the watch started, the same measure the
 * report's title uses: "Down $10 since it started". Null until there are two
 * values to compare.
 */
export function watchDirection(
  first: number | null,
  latest: number | null,
  currency: string,
  readings: number,
): Direction | null {
  if (first === null || latest === null || readings < 2) return null;
  if (latest < first) return { text: `Down ${money(round(first - latest), currency)} since it started`, tone: 'down' };
  if (latest > first) return { text: `Up ${money(round(latest - first), currency)} since it started`, tone: 'up' };
  return { text: 'No change since it started', tone: 'flat' };
}

/** "09:00:00" or "9:00" as "9:00 AM", the way the app writes a time. */
export function reportTimeLabel(time: string): string {
  const match = /^(\d{1,2}):(\d{2})/.exec(time);
  if (!match) return time;
  const hour = Number(match[1]);
  const minute = match[2]!;
  const period = hour < 12 ? 'AM' : 'PM';
  return `${hour % 12 === 0 ? 12 : hour % 12}:${minute} ${period}`;
}

function listed(parts: readonly string[]): string {
  if (parts.length <= 1) return parts.join('');
  return `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
}

/**
 * When the person will hear about it: a push when it goes under the line,
 * and a report at each time set. Null when neither is set, which Ask Dash
 * should not allow but the table does.
 */
export function hearLabel(row: Pick<WatchingRow, 'below' | 'currency' | 'reportTimes'>): string | null {
  const parts: string[] = [];
  if (row.below !== null) parts.push(`Push under ${money(row.below, row.currency)}`);
  const times = [...row.reportTimes].sort().map(reportTimeLabel);
  if (times.length > 0) parts.push(`report at ${listed(times)}`);
  if (parts.length === 0) return null;
  const text = parts.join(', ');
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function dayKey(at: Date, timezone: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(at);
}

/** "Ends today at 11:00 PM", "Ends tomorrow at 9:00 AM", "Ends Sat 4 Oct". */
export function endsLabel(endsAt: string, now: Date, timezone: string): string {
  const end = new Date(endsAt);
  const day = dayKey(end, timezone);
  const clock = formatClock(end, { timeZone: timezone });
  if (day === dayKey(now, timezone)) return `Ends today at ${clock}`;
  if (day === dayKey(new Date(now.getTime() + 86_400_000), timezone)) return `Ends tomorrow at ${clock}`;
  return `Ends ${new Intl.DateTimeFormat('en-GB', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    timeZone: timezone,
  }).format(end)}`;
}

/** A watch that is no longer running, as the loader reads it for Updates. */
export interface EndedWatch {
  id: string;
  title: string;
  status: 'ended' | 'stopped';
  /** When it stopped running: updated_at, which the status change touched. */
  at: string;
  below: number | null;
  fired: { value: number; at: string } | null;
  latest: number | null;
  first: number | null;
  currency: string;
  goalHref: string | null;
}

/**
 * An ended watch, once, in Updates, with how it came out: whether it fired
 * and where the price finished against where it started.
 */
export function endedUpdate(watch: EndedWatch): Update {
  const text =
    watch.status === 'stopped' ? `You stopped watching ${watch.title}` : `Finished watching ${watch.title}`;
  const parts: string[] = [];
  if (watch.fired) {
    parts.push(`Went under ${watch.below !== null ? money(watch.below, watch.currency) : 'the line'} at ${money(watch.fired.value, watch.currency)}`);
  } else if (watch.below !== null) {
    parts.push(`Never went under ${money(watch.below, watch.currency)}`);
  }
  if (watch.latest !== null) {
    parts.push(
      watch.first !== null && watch.first !== watch.latest
        ? `last read ${money(watch.latest, watch.currency)}, from ${money(watch.first, watch.currency)}`
        : `last read ${money(watch.latest, watch.currency)}`,
    );
  } else {
    parts.push('no price was ever read');
  }
  const detail = parts.join('; ');
  return {
    key: `watch-${watch.id}`,
    module: null,
    at: watch.at,
    text,
    detail: detail.charAt(0).toUpperCase() + detail.slice(1),
    href: watch.goalHref,
  };
}
