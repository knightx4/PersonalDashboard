import {
  TIMELINE_KINDS,
  TIMELINE_MODULES,
  type TimelineEvent,
  type TimelineKind,
  type TimelineModule,
} from './timeline';

/**
 * The timeline page's arithmetic (plan #1118): which month an event falls in
 * where the person lives, the window of months a page shows, and each month's
 * count per kind. Pure, so the page and the tests read the same rules.
 */

/** How many months one page of the timeline shows. */
export const MONTHS_PER_PAGE = 12;

/** A month as `YYYY-MM`. */
export type MonthKey = string;

export type TimelineMonth = {
  key: MonthKey;
  /** "September 2026". */
  label: string;
  /** How many of each kind, in the order TIMELINE_KINDS lists them; none at zero. */
  counts: { kind: TimelineKind; count: number }[];
  /** The month's events, newest first. */
  events: TimelineEvent[];
};

const MONTH_KEY = /^(\d{4})-(0[1-9]|1[0-2])$/;

export function isMonthKey(value: string | null | undefined): value is MonthKey {
  return typeof value === 'string' && MONTH_KEY.test(value);
}

/** The month an instant falls in, read on the person's own calendar. */
export function monthKeyOf(iso: string, timezone: string): MonthKey {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
  }).formatToParts(new Date(iso));
  const year = parts.find((part) => part.type === 'year')?.value ?? '1970';
  const month = parts.find((part) => part.type === 'month')?.value ?? '01';
  return `${year}-${month}`;
}

/** `key` moved by `delta` months. */
export function shiftMonth(key: MonthKey, delta: number): MonthKey {
  const [year, month] = key.split('-').map(Number);
  const index = year * 12 + (month - 1) + delta;
  const y = Math.floor(index / 12);
  const m = index - y * 12 + 1;
  return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}`;
}

/** "September 2026". */
export function monthLabel(key: MonthKey): string {
  const [year, month] = key.split('-').map(Number);
  return new Intl.DateTimeFormat('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(
    new Date(Date.UTC(year, month - 1, 1)),
  );
}

/**
 * The instant a month begins on the person's own calendar: midnight on its
 * first day in `timezone`, as an ISO timestamp.
 */
export function monthStart(key: MonthKey, timezone: string): string {
  const [year, month] = key.split('-').map(Number);
  const wall = Date.UTC(year, month - 1, 1);
  // The zone's offset at a guess, then again at the answer, which settles
  // the months whose first midnight sits on the other side of a clock change.
  let instant = wall - offsetAt(wall, timezone);
  instant = wall - offsetAt(instant, timezone);
  return new Date(instant).toISOString();
}

/** How far `timezone`'s clock is ahead of UTC at `instant`, in milliseconds. */
function offsetAt(instant: number, timezone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    hourCycle: 'h23',
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
    second: 'numeric',
  }).formatToParts(new Date(instant));
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((part) => part.type === type)?.value ?? 0);
  const wall = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'));
  return wall - Math.floor(instant / 1000) * 1000;
}

/**
 * The months one page covers: the `MONTHS_PER_PAGE` months that end with
 * `last`, and the instants between which their events fall.
 */
export function monthWindow(
  last: MonthKey,
  timezone: string,
): { first: MonthKey; last: MonthKey; from: string; to: string } {
  const first = shiftMonth(last, -(MONTHS_PER_PAGE - 1));
  return { first, last, from: monthStart(first, timezone), to: monthStart(shiftMonth(last, 1), timezone) };
}

/**
 * Events into months, newest month first, keeping only months from `first`
 * to `last` that have something in them. Events are expected newest first
 * and keep that order inside their month.
 */
export function groupByMonth(
  events: readonly TimelineEvent[],
  timezone: string,
  bounds: { first: MonthKey; last: MonthKey },
): TimelineMonth[] {
  const byKey = new Map<MonthKey, TimelineEvent[]>();
  for (const event of events) {
    const key = monthKeyOf(event.occurred_at, timezone);
    if (key < bounds.first || key > bounds.last) continue;
    const list = byKey.get(key);
    if (list) list.push(event);
    else byKey.set(key, [event]);
  }
  return [...byKey.entries()]
    .sort(([a], [b]) => (a < b ? 1 : a > b ? -1 : 0))
    .map(([key, monthEvents]) => ({
      key,
      label: monthLabel(key),
      counts: countKinds(monthEvents),
      events: monthEvents,
    }));
}

/** How many of each kind, in TIMELINE_KINDS order, leaving out the zeros. */
export function countKinds(events: readonly TimelineEvent[]): { kind: TimelineKind; count: number }[] {
  const tally = new Map<TimelineKind, number>();
  for (const event of events) tally.set(event.kind, (tally.get(event.kind) ?? 0) + 1);
  const order = TIMELINE_MODULES.flatMap((module) => TIMELINE_KINDS[module] as readonly TimelineKind[]);
  return order.filter((kind) => tally.has(kind)).map((kind) => ({ kind, count: tally.get(kind) ?? 0 }));
}

/** The module named in the address, when it is one the timeline reads and the person has on. */
export function parseTimelineModule(
  value: string | null | undefined,
  enabled: readonly string[],
): TimelineModule | null {
  const found = TIMELINE_MODULES.find((module) => module === value);
  return found && enabled.includes(found) ? found : null;
}
