import { describe, expect, it } from 'vitest';
import { addMonths, buildMonth, isMonth, monthDays, monthWindow } from '@/lib/todo/calendar/month';
import type { AgendaItem, DayContext } from '@/lib/todo/agenda/sources';
import type { Event } from '@/lib/todo/events/model';
import type { Task } from '@/lib/todo/tasks/model';

const NOW = new Date('2026-03-10T09:00:00.000Z');

function task(over: Partial<Task> = {}): Task {
  return {
    id: 'task-1',
    title: 'A task',
    body: null,
    status: 'open',
    dueOn: null,
    dueAt: null,
    pinned: false,
    snoozedUntil: null,
    completedAt: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    position: null,
    ...over,
  };
}

function event(over: Partial<Event> = {}): Event {
  return {
    id: 'event-1',
    title: 'An event',
    body: null,
    location: null,
    startsOn: null,
    endsOn: null,
    startsAt: null,
    endsAt: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    ...over,
  };
}

function item(over: Partial<AgendaItem> = {}): AgendaItem {
  return {
    key: 'job_reminders:r1',
    source: 'job_reminders',
    title: 'Follow up with Acme',
    day: '2026-03-10',
    at: null,
    link: null,
    action: null,
    detail: null,
    completable: true,
    ...over,
  };
}

function context(over: Partial<DayContext> = {}): DayContext {
  return {
    key: 'interview:i1',
    day: '2026-03-10',
    at: '2026-03-10T14:00:00.000Z',
    label: 'Acme · Staff Engineer',
    detail: null,
    link: { href: '/jobs/roles/r1', label: 'Prep' },
    ...over,
  };
}

function build(over: Partial<Parameters<typeof buildMonth>[0]> = {}) {
  return buildMonth({
    month: '2026-03',
    tasks: [],
    events: [],
    items: [],
    context: [],
    dismissals: new Map(),
    timezone: 'UTC',
    now: NOW,
    ...over,
  });
}

function dayIn(month: ReturnType<typeof build>, day: string) {
  return month.weeks.flat().find((cell) => cell.day === day)!;
}

describe('isMonth', () => {
  it('accepts a real month and rejects anything else', () => {
    expect(isMonth('2026-03')).toBe(true);
    expect(isMonth('2026-13')).toBe(false);
    expect(isMonth('2026-00')).toBe(false);
    expect(isMonth('2026-3')).toBe(false);
    expect(isMonth('2026-03-01')).toBe(false);
  });
});

describe('addMonths', () => {
  it('wraps the year in both directions', () => {
    expect(addMonths('2026-12', 1)).toBe('2027-01');
    expect(addMonths('2026-01', -1)).toBe('2025-12');
  });

  /** The 31st of a 31-day month is the trap: setUTCMonth would roll it over. */
  it('does not overshoot from a long month into a short one', () => {
    expect(addMonths('2026-01', 1)).toBe('2026-02');
  });
});

describe('monthDays', () => {
  it('always draws six whole weeks, Monday first', () => {
    const days = monthDays('2026-03');
    expect(days).toHaveLength(42);
    // 1 March 2026 is a Sunday, so the grid opens on Monday 23 February.
    expect(days[0]).toBe('2026-02-23');
    expect(days[41]).toBe('2026-04-05');
  });

  it('starts on the first when the month itself starts on a Monday', () => {
    expect(monthDays('2026-06')[0]).toBe('2026-06-01');
  });

  it('reports the window it drew', () => {
    expect(monthWindow('2026-03')).toEqual({ from: '2026-02-23', to: '2026-04-05' });
  });
});

describe('buildMonth', () => {
  it('puts a task on its due day and marks today', () => {
    const month = build({ tasks: [task({ dueOn: '2026-03-10' })] });

    expect(dayIn(month, '2026-03-10').entries.map((e) => e.title)).toEqual(['A task']);
    expect(dayIn(month, '2026-03-10').isToday).toBe(true);
    expect(dayIn(month, '2026-03-11').entries).toEqual([]);
  });

  it('marks the neighbouring months out of month', () => {
    const month = build();
    expect(dayIn(month, '2026-02-23').inMonth).toBe(false);
    expect(dayIn(month, '2026-03-01').inMonth).toBe(true);
    expect(dayIn(month, '2026-04-05').inMonth).toBe(false);
  });

  /** The whole reason there are two due columns. */
  it('places an instant in the reader s day, not the UTC one', () => {
    const late = task({ dueAt: '2026-03-10T23:30:00.000Z' });

    expect(dayIn(build({ tasks: [late] }), '2026-03-10').entries).toHaveLength(1);
    expect(
      dayIn(build({ tasks: [late], timezone: 'Asia/Tokyo' }), '2026-03-11').entries,
    ).toHaveLength(1);
  });

  it('keeps a finished task, struck through, and drops a dropped one', () => {
    const month = build({
      tasks: [
        task({ id: 'a', title: 'Done thing', status: 'done', dueOn: '2026-03-05' }),
        task({ id: 'b', title: 'Dropped thing', status: 'dropped', dueOn: '2026-03-05' }),
      ],
    });

    expect(dayIn(month, '2026-03-05').entries).toEqual([
      expect.objectContaining({ title: 'Done thing', done: true }),
    ]);
  });

  it('lists undated open tasks separately, and forgets finished ones', () => {
    const month = build({
      tasks: [
        task({ id: 'a', title: 'Someday' }),
        task({ id: 'b', title: 'Finished, never dated', status: 'done' }),
      ],
    });

    expect(month.undated.map((entry) => entry.title)).toEqual(['Someday']);
  });

  it('carries a source item through with its link, and honours a dismissal', () => {
    const shown = build({ items: [item({ link: { href: '/jobs/roles/r1', label: 'Acme' } })] });
    expect(dayIn(shown, '2026-03-10').entries).toEqual([
      expect.objectContaining({ kind: 'item', href: '/jobs/roles/r1' }),
    ]);

    const hidden = build({
      items: [item()],
      dismissals: new Map([['job_reminders:r1', { until: null }]]),
    });
    expect(dayIn(hidden, '2026-03-10').entries).toEqual([]);
  });

  it('brings a deferral back once it has run out', () => {
    const month = build({
      items: [item()],
      dismissals: new Map([['job_reminders:r1', { until: '2026-03-09T00:00:00.000Z' }]]),
    });
    expect(dayIn(month, '2026-03-10').entries).toHaveLength(1);
  });

  it('shows an appointment alongside the tasks of its day', () => {
    const month = build({ context: [context()] });
    expect(dayIn(month, '2026-03-10').entries).toEqual([
      expect.objectContaining({ kind: 'context', title: 'Acme · Staff Engineer' }),
    ]);
  });

  it('orders a day by the clock, then puts your own tasks first', () => {
    const month = build({
      tasks: [
        task({ id: 'a', title: 'All day mine', dueOn: '2026-03-10' }),
        task({ id: 'b', title: 'Nine sharp', dueAt: '2026-03-10T09:00:00.000Z' }),
      ],
      items: [item({ title: 'All day theirs' })],
      context: [context()],
    });

    expect(dayIn(month, '2026-03-10').entries.map((entry) => entry.title)).toEqual([
      'Nine sharp',
      'Acme · Staff Engineer',
      'All day mine',
      'All day theirs',
    ]);
  });

  it('puts a timed event on its day, with the hours it runs', () => {
    const month = build({
      events: [
        event({
          title: 'Dentist',
          startsAt: '2026-03-10T15:00:00.000Z',
          endsAt: '2026-03-10T15:30:00.000Z',
        }),
      ],
    });

    expect(dayIn(month, '2026-03-10').entries).toEqual([
      expect.objectContaining({
        kind: 'event',
        title: 'Dentist',
        at: '2026-03-10T15:00:00.000Z',
        end: '2026-03-10T15:30:00.000Z',
      }),
    ]);
    expect(dayIn(month, '2026-03-11').entries).toEqual([]);
  });

  it('puts an all-day event on its day with no clock on it', () => {
    // No `at`, which is what puts it in the all-day row of the day and week
    // views rather than in an hour.
    const month = build({
      events: [event({ title: 'Bank holiday', startsOn: '2026-03-10', endsOn: '2026-03-10' })],
    });

    expect(dayIn(month, '2026-03-10').entries).toEqual([
      expect.objectContaining({ kind: 'event', at: null, end: null }),
    ]);
  });

  it('puts an event running over three days on each of them', () => {
    const month = build({
      events: [event({ title: 'Half term', startsOn: '2026-03-10', endsOn: '2026-03-12' })],
    });

    for (const day of ['2026-03-10', '2026-03-11', '2026-03-12']) {
      expect(dayIn(month, day).entries.map((entry) => entry.title)).toEqual(['Half term']);
    }
    expect(dayIn(month, '2026-03-13').entries).toEqual([]);
  });

  it('holds each day only the part of an event that is on it', () => {
    // A meeting that runs into the small hours is on both days, and neither
    // day is drawn as holding the whole of it.
    const month = build({
      events: [
        event({
          title: 'Night shift',
          startsAt: '2026-03-10T23:00:00.000Z',
          endsAt: '2026-03-11T01:00:00.000Z',
        }),
      ],
    });

    expect(dayIn(month, '2026-03-10').entries).toEqual([
      expect.objectContaining({ at: '2026-03-10T23:00:00.000Z', end: '2026-03-11T00:00:00.000Z' }),
    ]);
    expect(dayIn(month, '2026-03-11').entries).toEqual([
      expect.objectContaining({ at: '2026-03-11T00:00:00.000Z', end: '2026-03-11T01:00:00.000Z' }),
    ]);
  });

  it('files an evening event under the day it is on for this reader', () => {
    const evening = event({
      title: 'Late call',
      startsAt: '2026-03-10T23:30:00.000Z',
      endsAt: '2026-03-10T23:45:00.000Z',
    });

    expect(dayIn(build({ events: [evening] }), '2026-03-10').entries).toHaveLength(1);
    expect(
      dayIn(build({ events: [evening], timezone: 'Asia/Tokyo' }), '2026-03-11').entries,
    ).toHaveLength(1);
    expect(
      dayIn(build({ events: [evening], timezone: 'Asia/Tokyo' }), '2026-03-10').entries,
    ).toEqual([]);
  });

  it('reads an event before a task at the same time', () => {
    const month = build({
      tasks: [task({ title: 'Nine sharp', dueAt: '2026-03-10T09:00:00.000Z' })],
      events: [
        event({
          title: 'Standup',
          startsAt: '2026-03-10T09:00:00.000Z',
          endsAt: '2026-03-10T09:15:00.000Z',
        }),
      ],
    });

    expect(dayIn(month, '2026-03-10').entries.map((entry) => entry.title)).toEqual([
      'Standup',
      'Nine sharp',
    ]);
  });

  it('ignores anything outside the grid rather than crowding an edge square', () => {
    const month = build({ tasks: [task({ dueOn: '2026-05-01' })] });
    expect(month.weeks.flat().every((cell) => cell.entries.length === 0)).toBe(true);
  });
});
