import { describe, expect, it } from 'vitest';
import {
  blocksFor,
  buildRange,
  hourIn,
  hourSpan,
  hourWindow,
  hoursOf,
  isCalendarView,
  isDay,
  shiftAnchor,
  startOfWeek,
  viewDays,
  viewWindow,
} from '@/lib/todo/calendar/range';
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
    parentId: null,
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

function build(over: Partial<Parameters<typeof buildRange>[0]> = {}) {
  return buildRange({
    view: 'week',
    anchor: '2026-03-10',
    tasks: [],
    events: [],
    items: [] as AgendaItem[],
    context: [] as DayContext[],
    dismissals: new Map(),
    timezone: 'UTC',
    now: NOW,
    ...over,
  });
}

describe('isDay', () => {
  it('takes a real day', () => {
    expect(isDay('2026-03-10')).toBe(true);
    expect(isDay('2024-02-29')).toBe(true);
  });

  it('refuses ten characters that only look like one', () => {
    expect(isDay('2026-02-30')).toBe(false);
    expect(isDay('2026-13-01')).toBe(false);
    expect(isDay('2026-3-10')).toBe(false);
    expect(isDay('tomorrow')).toBe(false);
  });
});

describe('isCalendarView', () => {
  it('knows the three', () => {
    expect(isCalendarView('day')).toBe(true);
    expect(isCalendarView('week')).toBe(true);
    expect(isCalendarView('month')).toBe(true);
    expect(isCalendarView('year')).toBe(false);
  });
});

describe('startOfWeek', () => {
  it('is the Monday, and a Monday is its own', () => {
    // 2026-03-10 is a Tuesday.
    expect(startOfWeek('2026-03-10')).toBe('2026-03-09');
    expect(startOfWeek('2026-03-09')).toBe('2026-03-09');
    // 2026-03-15 is a Sunday: the end of that same week, not the start of the
    // next one.
    expect(startOfWeek('2026-03-15')).toBe('2026-03-09');
  });
});

describe('viewDays', () => {
  it('gives a day one day', () => {
    expect(viewDays('day', '2026-03-10')).toEqual(['2026-03-10']);
  });

  it('gives a week seven, Monday first', () => {
    expect(viewDays('week', '2026-03-12')).toEqual([
      '2026-03-09',
      '2026-03-10',
      '2026-03-11',
      '2026-03-12',
      '2026-03-13',
      '2026-03-14',
      '2026-03-15',
    ]);
  });

  it('gives a month its six whole weeks whatever day it is anchored on', () => {
    const days = viewDays('month', '2026-03-24');
    expect(days).toHaveLength(42);
    expect(days[0]).toBe('2026-02-23');
    expect(days[41]).toBe('2026-04-05');
  });
});

describe('viewWindow', () => {
  it('is the first and last day drawn, which is what the sources are asked for', () => {
    expect(viewWindow('day', '2026-03-10')).toEqual({ from: '2026-03-10', to: '2026-03-10' });
    expect(viewWindow('week', '2026-03-10')).toEqual({ from: '2026-03-09', to: '2026-03-15' });
    expect(viewWindow('month', '2026-03-10')).toEqual({ from: '2026-02-23', to: '2026-04-05' });
  });
});

describe('shiftAnchor', () => {
  it('steps a day and a week', () => {
    expect(shiftAnchor('day', '2026-03-10', 1)).toBe('2026-03-11');
    expect(shiftAnchor('day', '2026-03-01', -1)).toBe('2026-02-28');
    expect(shiftAnchor('week', '2026-03-10', 1)).toBe('2026-03-16');
    expect(shiftAnchor('week', '2026-03-10', -1)).toBe('2026-03-02');
  });

  it('steps a month to the first of it, never inventing a 31st', () => {
    expect(shiftAnchor('month', '2026-03-31', -1)).toBe('2026-02-01');
    expect(shiftAnchor('month', '2026-12-15', 1)).toBe('2027-01-01');
  });
});

describe('buildRange', () => {
  it('files a task on its day and marks today', () => {
    const range = build({
      view: 'week',
      tasks: [task({ dueOn: '2026-03-11', title: 'Ring the bank' })],
    });

    expect(range.days).toHaveLength(7);
    expect(range.days.map((day) => day.entries.length)).toEqual([0, 0, 1, 0, 0, 0, 0]);
    expect(range.days[2].entries[0].title).toBe('Ring the bank');
    expect(range.days.filter((day) => day.isToday).map((day) => day.day)).toEqual(['2026-03-10']);
  });

  it('dims nothing outside a month view: every day of a week was asked for', () => {
    expect(build({ view: 'week' }).days.every((day) => day.inMonth)).toBe(true);
    expect(build({ view: 'day', anchor: '2026-03-10' }).days[0].inMonth).toBe(true);

    const month = build({ view: 'month', anchor: '2026-03-10' });
    expect(month.days[0].inMonth).toBe(false);
    expect(month.days[21].inMonth).toBe(true);
  });

  it('spreads an event across the days of the week it covers', () => {
    const range = build({
      view: 'week',
      events: [event({ title: 'Half term', startsOn: '2026-03-11', endsOn: '2026-03-13' })],
    });

    expect(range.days.map((day) => day.entries.length)).toEqual([0, 0, 1, 1, 1, 0, 0]);
    expect(range.days[2].entries[0]).toEqual(
      expect.objectContaining({ kind: 'event', title: 'Half term', at: null }),
    );
  });

  it('gives a day view the hours a timed event runs', () => {
    const range = build({
      view: 'day',
      anchor: '2026-03-10',
      events: [
        event({
          title: 'Review',
          startsAt: '2026-03-10T10:00:00.000Z',
          endsAt: '2026-03-10T12:00:00.000Z',
        }),
      ],
    });

    expect(range.days[0].entries[0]).toEqual(
      expect.objectContaining({ at: '2026-03-10T10:00:00.000Z', end: '2026-03-10T12:00:00.000Z' }),
    );
    expect(hourIn(range.days[0].entries[0].at as string, 'UTC')).toBe(10);
  });

  it('keeps a dateless task out of the grid and in the backlog', () => {
    const range = build({ tasks: [task({ title: 'Someday' })] });
    expect(range.days.every((day) => day.entries.length === 0)).toBe(true);
    expect(range.undated.map((entry) => entry.title)).toEqual(['Someday']);
  });
});

describe('hourIn', () => {
  it('is the hour where the reader is standing, not where the row was written', () => {
    expect(hourIn('2026-03-10T14:00:00.000Z', 'UTC')).toBe(14);
    expect(hourIn('2026-03-10T14:00:00.000Z', 'America/New_York')).toBe(10);
    // Midnight is hour 0, not 24.
    expect(hourIn('2026-03-10T00:30:00.000Z', 'UTC')).toBe(0);
  });
});

describe('hourWindow', () => {
  it('is the working day when nothing falls outside it', () => {
    const range = build({ tasks: [task({ dueAt: '2026-03-10T14:00:00.000Z' })] });
    expect(hourWindow(range.days, 'UTC')).toEqual({ from: 8, to: 18 });
  });

  it('widens to hold a 06:00 flight and a 23:00 deadline', () => {
    const range = build({
      tasks: [
        task({ id: 'a', dueAt: '2026-03-10T06:00:00.000Z' }),
        task({ id: 'b', dueAt: '2026-03-11T23:15:00.000Z' }),
      ],
    });
    expect(hourWindow(range.days, 'UTC')).toEqual({ from: 6, to: 23 });
  });

  it('ignores what has no clock', () => {
    const range = build({ tasks: [task({ dueOn: '2026-03-10' })] });
    expect(hourWindow(range.days, 'UTC')).toEqual({ from: 8, to: 18 });
  });
});

describe('hourSpan', () => {
  const block = (at: string, end: string) => hourSpan({ at, end }, 'UTC');

  it('covers the hours a meeting runs, and stops on the hour it ends', () => {
    // 10:00 to 12:00 is the 10 and 11 rows. Reaching into 12 would draw an
    // hour the meeting does not use.
    expect(block('2026-03-10T10:00:00.000Z', '2026-03-10T12:00:00.000Z')).toEqual({
      from: 10,
      to: 11,
    });
  });

  it('gives something shorter than an hour a row of its own', () => {
    expect(block('2026-03-10T10:00:00.000Z', '2026-03-10T10:15:00.000Z')).toEqual({
      from: 10,
      to: 10,
    });
    expect(block('2026-03-10T10:00:00.000Z', '2026-03-10T10:00:00.000Z')).toEqual({
      from: 10,
      to: 10,
    });
  });

  it('runs to the end of the day for an event that carries on past midnight', () => {
    expect(block('2026-03-10T23:00:00.000Z', '2026-03-11T00:00:00.000Z')).toEqual({
      from: 23,
      to: 23,
    });
  });

  it('is nothing for a thing with no duration', () => {
    expect(hourSpan({ at: '2026-03-10T10:00:00.000Z', end: null }, 'UTC')).toBeNull();
    expect(hourSpan({ at: null, end: null }, 'UTC')).toBeNull();
  });
});

describe('blocksFor', () => {
  function timed(key: string, from: string, to: string) {
    return {
      key,
      kind: 'event' as const,
      at: `2026-03-10T${from}:00.000Z`,
      end: `2026-03-10T${to}:00.000Z`,
      eventId: key,
      feedEventId: null,
      title: key,
      href: null,
      done: false,
    };
  }

  it('gives a lone event the whole column', () => {
    expect(blocksFor([timed('a', '10:00', '12:00')], 'UTC')).toEqual([
      { entry: expect.objectContaining({ key: 'a' }), from: 10, to: 11, lane: 0, lanes: 1 },
    ]);
  });

  it('puts two events that clash side by side', () => {
    const blocks = blocksFor([timed('a', '10:00', '12:00'), timed('b', '11:00', '13:00')], 'UTC');
    expect(blocks.map((block) => [block.entry.key, block.lane, block.lanes])).toEqual([
      ['a', 0, 2],
      ['b', 1, 2],
    ]);
  });

  it('starts again at full width after a gap', () => {
    const blocks = blocksFor(
      [timed('a', '09:00', '10:00'), timed('b', '09:30', '10:00'), timed('c', '14:00', '15:00')],
      'UTC',
    );
    expect(blocks.map((block) => [block.entry.key, block.lanes])).toEqual([
      ['a', 2],
      ['b', 2],
      ['c', 1],
    ]);
  });

  it('reuses a lane once the event in it has finished', () => {
    const blocks = blocksFor(
      [timed('a', '09:00', '11:00'), timed('b', '10:00', '13:00'), timed('c', '11:00', '12:00')],
      'UTC',
    );
    expect(blocks.map((block) => [block.entry.key, block.lane])).toEqual([
      ['a', 0],
      ['b', 1],
      ['c', 0],
    ]);
  });

  it('ignores everything without a duration', () => {
    const instant = {
      key: 'task:1',
      kind: 'task' as const,
      at: '2026-03-10T10:00:00.000Z',
      end: null,
      eventId: null,
      feedEventId: null,
      title: 'A task',
      href: null,
      done: false,
    };
    expect(blocksFor([instant], 'UTC')).toEqual([]);
  });
});

describe('hoursOf', () => {
  it('draws both ends', () => {
    expect(hoursOf({ from: 8, to: 10 })).toEqual([8, 9, 10]);
    expect(hoursOf({ from: 0, to: 23 })).toHaveLength(24);
  });
});
