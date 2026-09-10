import { addDays, todayIn } from '@/lib/todo/tasks/model';
import {
  addMonths,
  collectEntries,
  compareEntries,
  monthDays,
  monthOf,
  type BuildInput,
  type CalendarDay,
  type CalendarEntry,
} from '@/lib/todo/calendar/month';

/**
 * A day, a week or a month of it -- the three scopes a calendar is read at.
 *
 * PURE, like month.ts beside it and for the same reason: which Monday a week
 * starts on, which hours a day has to draw, and whether a 23:30 instant is
 * tonight are date questions, and a date question that needs a database to
 * test is a date question that stays wrong.
 *
 * The month view keeps its own builder next door because a month grid is six
 * fixed weeks with neighbouring days in it, which is a different shape from
 * "the days in this range". Everything below the shape -- what falls on a day,
 * in what order -- is shared, so the three views can never disagree.
 */

export const CALENDAR_VIEWS = ['day', 'week', 'month'] as const;

export type CalendarView = (typeof CALENDAR_VIEWS)[number];

export const CALENDAR_VIEW_LABEL: Record<CalendarView, string> = {
  day: 'Day',
  week: 'Week',
  month: 'Month',
};

const DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/** A real calendar day, not merely ten characters shaped like one. */
export function isDay(value: string): boolean {
  if (!DAY_PATTERN.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export function isCalendarView(value: string): value is CalendarView {
  return (CALENDAR_VIEWS as readonly string[]).includes(value);
}

/**
 * The Monday of the week holding a day.
 *
 * Monday, because the app writes its dates en-GB and a week there starts on
 * one. `getUTCDay()` is Sunday-first, hence the shift.
 */
export function startOfWeek(day: string): string {
  const date = new Date(`${day}T00:00:00Z`);
  return addDays(day, -((date.getUTCDay() + 6) % 7));
}

/** Every day a view draws, in order. */
export function viewDays(view: CalendarView, anchor: string): string[] {
  if (view === 'day') return [anchor];
  if (view === 'week') {
    const monday = startOfWeek(anchor);
    return Array.from({ length: 7 }, (_, index) => addDays(monday, index));
  }
  return monthDays(monthOf(anchor));
}

/** The first and last day shown -- the window the sources are asked for. */
export function viewWindow(view: CalendarView, anchor: string): { from: string; to: string } {
  const days = viewDays(view, anchor);
  return { from: days[0], to: days[days.length - 1] };
}

/**
 * The day the previous or next page of this view is anchored on.
 *
 * A month steps to the first of the next month rather than to the same day
 * number in it: paging from 31 March would otherwise have to invent 31
 * February, and the answer to "which month am I looking at" must not depend on
 * which day you happened to arrive on.
 */
export function shiftAnchor(view: CalendarView, anchor: string, delta: number): string {
  if (view === 'day') return addDays(anchor, delta);
  if (view === 'week') return addDays(startOfWeek(anchor), delta * 7);
  return `${addMonths(monthOf(anchor), delta)}-01`;
}

export interface CalendarRange {
  view: CalendarView;
  /** The day the view is anchored on. */
  anchor: string;
  days: CalendarDay[];
  undated: CalendarEntry[];
}

export function buildRange(
  input: Omit<BuildInput, 'month'> & { view: CalendarView; anchor: string },
): CalendarRange {
  const today = todayIn(input.timezone, input.now);
  const { byDay, undated } = collectEntries(input);
  const month = monthOf(input.anchor);

  const days = viewDays(input.view, input.anchor).map<CalendarDay>((day) => ({
    day,
    // Only a month grid has days from beside it. In a day or a week every day
    // shown is one you asked for, so none of them is dimmed.
    inMonth: input.view === 'month' ? monthOf(day) === month : true,
    isToday: day === today,
    entries: [...(byDay.get(day) ?? [])].sort(compareEntries),
  }));

  return { view: input.view, anchor: input.anchor, days, undated };
}

/** The hour of an instant, where the reader is standing. */
export function hourIn(iso: string, timezone: string): number {
  const hour = new Intl.DateTimeFormat('en-GB', {
    timeZone: timezone,
    hour: '2-digit',
    hourCycle: 'h23',
  }).format(new Date(iso));
  return Number(hour);
}

/**
 * The hours a thing with a duration covers, both ends inclusive.
 *
 * Only an event has one; everything else on the calendar is a moment and gets
 * null. An end exactly on the hour stops at the row before it, so a meeting
 * from 10:00 to 12:00 covers 10 and 11 rather than reaching into a third hour
 * it does not use.
 *
 * Each entry is already clamped to the day it is drawn on, so both ends are
 * hours of the same day.
 */
export function hourSpan(
  entry: Pick<CalendarEntry, 'at' | 'end'>,
  timezone: string,
): { from: number; to: number } | null {
  if (!entry.at || !entry.end) return null;

  const from = hourIn(entry.at, timezone);
  const lastMoment = new Date(new Date(entry.end).getTime() - 1).toISOString();
  return { from, to: Math.max(from, hourIn(lastMoment, timezone)) };
}

/**
 * The band of hours a day or week draws: 08:00 to 18:00, widened to hold
 * whatever is actually there.
 *
 * All twenty-four every time would be a screen of empty night with the day
 * squeezed into the middle of it, and the alternative -- scrolling the grid to
 * the working hours on load -- needs JavaScript to do a job the server already
 * knows the answer to. Widening rather than replacing keeps the shape of a day
 * recognisable when the only thing in it is a 06:00 flight.
 */
export const DEFAULT_HOURS: { from: number; to: number } = { from: 8, to: 18 };

export function hourWindow(
  days: readonly CalendarDay[],
  timezone: string,
): { from: number; to: number } {
  let from = DEFAULT_HOURS.from;
  let to = DEFAULT_HOURS.to;

  for (const day of days) {
    for (const entry of day.entries) {
      if (!entry.at) continue;
      const hour = hourIn(entry.at, timezone);
      if (hour < from) from = hour;
      // An event is widened to by its end as well, or a meeting running to
      // 22:00 would be drawn as a block reaching past the bottom of the grid.
      const last = hourSpan(entry, timezone)?.to ?? hour;
      if (last > to) to = last;
    }
  }

  return { from, to };
}

/** The hours the grid draws, inclusive of both ends. */
export function hoursOf(window: { from: number; to: number }): number[] {
  return Array.from({ length: window.to - window.from + 1 }, (_, index) => window.from + index);
}

/** A thing with a duration, and where it sits among the ones it overlaps. */
export interface CalendarBlock {
  entry: CalendarEntry;
  /** The first and last hour row it covers. */
  from: number;
  to: number;
  /** Which side-by-side lane it takes, and how many the day's grid is wide there. */
  lane: number;
  lanes: number;
}

/**
 * The blocks of one day, laid out so that none of them hides another.
 *
 * Two meetings at the same time are drawn side by side rather than stacked, so
 * a clash looks like a clash. The lanes are counted per run of overlapping
 * events rather than across the whole day: a single afternoon appointment is
 * full width even when the morning had three people booking over each other.
 *
 * Greedy, taking the earliest start first and reusing the first lane that has
 * finished. That is not the tightest packing possible, and a personal calendar
 * has nowhere near enough at once for the difference to show.
 */
export function blocksFor(entries: readonly CalendarEntry[], timezone: string): CalendarBlock[] {
  const spans = entries
    .map((entry) => ({ entry, span: hourSpan(entry, timezone) }))
    .filter((row): row is { entry: CalendarEntry; span: { from: number; to: number } } =>
      row.span !== null,
    )
    .sort((a, b) => a.span.from - b.span.from || b.span.to - a.span.to);

  const blocks: CalendarBlock[] = [];
  let cluster: CalendarBlock[] = [];
  let laneEnds: number[] = [];

  const flush = () => {
    for (const block of cluster) block.lanes = laneEnds.length;
    blocks.push(...cluster);
    cluster = [];
    laneEnds = [];
  };

  for (const { entry, span } of spans) {
    // A gap with nothing running through it ends the run, and the next one
    // starts again at full width.
    if (laneEnds.length > 0 && span.from > Math.max(...laneEnds)) flush();

    let lane = laneEnds.findIndex((end) => end < span.from);
    if (lane === -1) lane = laneEnds.length;
    laneEnds[lane] = span.to;

    cluster.push({ entry, from: span.from, to: span.to, lane, lanes: 1 });
  }

  flush();
  return blocks;
}
