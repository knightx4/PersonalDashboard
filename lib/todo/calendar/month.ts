import { addDays, dueDay, todayIn, type Task } from '@/lib/todo/tasks/model';
import { stillHidden } from '@/lib/todo/agenda/merge';
import { eventDays, isAllDay, type Event } from '@/lib/todo/events/model';
import { wallClockToInstant } from '@/lib/todo/time';
import type { AgendaItem, DayContext } from '@/lib/todo/agenda/sources';

/**
 * The month grid, and what falls on each of its days.
 *
 * PURE, for the same reason lib/todo/agenda/merge.ts is: everything that can be
 * wrong about a calendar is a date question -- which week a month starts in,
 * whether a 23:30 instant is tonight or tomorrow for this reader, whether a
 * deferred item is still deferred -- and none of it should need a database to
 * test. The loader next door does the I/O and hands the answers here.
 *
 * The agenda answers "what needs me next". This answers "what does the month
 * look like", which is a different question and the reason the piles could not
 * simply be drawn on a grid: a pile has no notion of an empty Thursday, and an
 * empty Thursday is most of what a calendar is for.
 */

/** One thing drawn in a day's cell. */
export interface CalendarEntry {
  key: string;
  kind: 'event' | 'task' | 'item' | 'context';
  /** An instant, when the thing has a clock. Formatted by the caller. */
  at: string | null;
  /**
   * When it stops. Only an event has one: a task due at 14:00 and a return
   * deadline are moments, and inventing a length for them would be the
   * calendar claiming something nobody typed.
   *
   * On a day an event only passes through, this is the end of that day rather
   * than the end of the event -- each day holds the part of the event that is
   * actually on it.
   */
  end: string | null;
  /**
   * The row an event was drawn from, which is what opens it. Null for
   * everything else: a task, an interview and a return deadline are opened
   * where they live, not here.
   */
  eventId: string | null;
  title: string;
  /** Where clicking it goes, when there is anywhere to go. */
  href: string | null;
  /** Whether it is already finished -- drawn through rather than hidden. */
  done: boolean;
}

export interface CalendarDay {
  /** YYYY-MM-DD. */
  day: string;
  /** False for the leading and trailing days of the neighbouring months. */
  inMonth: boolean;
  isToday: boolean;
  entries: CalendarEntry[];
}

export interface CalendarMonth {
  /** YYYY-MM. */
  month: string;
  /** Six weeks of seven days, always. */
  weeks: CalendarDay[][];
  /** Tasks with no due date at all: they belong to no square, and saying so is
   *  better than a calendar that quietly holds fewer tasks than the list. */
  undated: CalendarEntry[];
}

const MONTH_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/;

export function isMonth(value: string): boolean {
  return MONTH_PATTERN.test(value);
}

/** The month a calendar day belongs to. */
export function monthOf(day: string): string {
  return day.slice(0, 7);
}

/** A month `count` months after `month`, wrapping the year. */
export function addMonths(month: string, count: number): string {
  const date = new Date(`${month}-01T00:00:00Z`);
  date.setUTCMonth(date.getUTCMonth() + count);
  return date.toISOString().slice(0, 7);
}

/**
 * Every day the grid draws: six whole weeks, Monday first.
 *
 * Six rows always, even when five would fit. A grid that changes height as you
 * page through it moves everything below it, and paging back and forth is the
 * main thing anyone does on this page.
 */
export function monthDays(month: string): string[] {
  const first = new Date(`${month}-01T00:00:00Z`);
  // getUTCDay() is Sunday-first; the app writes dates en-GB, where a week
  // starts on Monday.
  const lead = (first.getUTCDay() + 6) % 7;

  const start = new Date(first);
  start.setUTCDate(start.getUTCDate() - lead);

  return Array.from({ length: 42 }, (_, index) => {
    const day = new Date(start);
    day.setUTCDate(day.getUTCDate() + index);
    return day.toISOString().slice(0, 10);
  });
}

/** The first and last day the grid shows -- the window its sources are asked for. */
export function monthWindow(month: string): { from: string; to: string } {
  const days = monthDays(month);
  return { from: days[0], to: days[days.length - 1] };
}

export interface BuildInput {
  month: string;
  tasks: Task[];
  events: Event[];
  items: AgendaItem[];
  context: DayContext[];
  /** Keys of source items deferred or dismissed, and until when. */
  dismissals: Map<string, { until: string | null }>;
  timezone: string;
  now: Date;
}

/**
 * Everything the sources hold, filed under the day it falls on.
 *
 * Shared with the day and week views next door rather than copied into them:
 * which day a thing belongs to, and whether it belongs on a calendar at all,
 * must not have three answers.
 */
export function collectEntries(
  input: Omit<BuildInput, 'month'>,
): { byDay: Map<string, CalendarEntry[]>; undated: CalendarEntry[] } {
  const { timezone, now } = input;

  const byDay = new Map<string, CalendarEntry[]>();
  const undated: CalendarEntry[] = [];

  const push = (day: string | null, entry: CalendarEntry) => {
    if (day === null) {
      undated.push(entry);
      return;
    }
    byDay.set(day, [...(byDay.get(day) ?? []), entry]);
  };

  for (const task of input.tasks) {
    // A dropped task is a decision not to do it. It has no place in a picture
    // of what the month holds.
    if (task.status === 'dropped') continue;

    const day = dueDay(task, timezone);
    // "No date" is a list of what is still waiting for one. A finished task
    // that never had a date belongs to no month and to no backlog either --
    // putting it here would grow that list forever.
    if (day === null && task.status !== 'open') continue;

    push(day, {
      key: `task:${task.id}`,
      kind: 'task',
      at: task.dueAt,
      end: null,
      eventId: null,
      title: task.title,
      href: null,
      done: task.status === 'done',
    });
  }

  // An event is on every day it covers, as a pill on each of them rather than
  // a bar stretched across the grid: a month is six fixed weeks of squares, and
  // a bar would have to be laid out over that rather than inside a square.
  for (const event of input.events) {
    const days = eventDays(event, timezone);
    const last = days.length - 1;

    days.forEach((day, index) => {
      // What of the event is on this day. The first day starts when the event
      // does and the last day ends when it does; a day in between is covered
      // from midnight to midnight, so nothing is drawn outside the day it is on.
      const at = isAllDay(event)
        ? null
        : index === 0
          ? event.startsAt
          : wallClockToInstant(day, '00:00', timezone);
      const end = isAllDay(event)
        ? null
        : index === last
          ? event.endsAt
          : wallClockToInstant(addDays(day, 1), '00:00', timezone);

      push(day, {
        key: `event:${event.id}`,
        kind: 'event',
        at,
        end,
        eventId: event.id,
        title: event.title,
        href: null,
        done: false,
      });
    });
  }

  for (const item of input.items) {
    if (stillHidden(input.dismissals.get(item.key), now)) continue;

    push(item.day, {
      key: `item:${item.key}`,
      kind: 'item',
      at: item.at,
      end: null,
      eventId: null,
      title: item.title,
      href: item.link?.href ?? null,
      done: false,
    });
  }

  for (const entry of input.context) {
    push(entry.day, {
      key: `context:${entry.key}`,
      kind: 'context',
      at: entry.at,
      end: null,
      eventId: null,
      title: entry.label,
      href: entry.link?.href ?? null,
      done: false,
    });
  }

  return { byDay, undated: undated.sort(compareEntries) };
}

export function buildMonth(input: BuildInput): CalendarMonth {
  const today = todayIn(input.timezone, input.now);
  const { byDay, undated } = collectEntries(input);

  const days = monthDays(input.month).map<CalendarDay>((day) => ({
    day,
    inMonth: monthOf(day) === input.month,
    isToday: day === today,
    entries: [...(byDay.get(day) ?? [])].sort(compareEntries),
  }));

  const weeks: CalendarDay[][] = [];
  for (let index = 0; index < days.length; index += 7) weeks.push(days.slice(index, index + 7));

  return { month: input.month, weeks, undated };
}

/**
 * Inside a square: what has a clock, in clock order, then what merely happens
 * that day. What you typed -- an event, then a task -- before what another
 * workspace noticed, which is the order the agenda already puts them in.
 */
const KIND_ORDER: Record<CalendarEntry['kind'], number> = {
  event: 0,
  task: 1,
  item: 2,
  context: 3,
};

export function compareEntries(a: CalendarEntry, b: CalendarEntry): number {
  if ((a.at === null) !== (b.at === null)) return a.at === null ? 1 : -1;
  if (a.at && b.at && a.at !== b.at) return a.at < b.at ? -1 : 1;
  if (a.kind !== b.kind) return KIND_ORDER[a.kind] - KIND_ORDER[b.kind];
  return a.title.localeCompare(b.title);
}
