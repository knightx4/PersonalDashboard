import { describe, expect, it } from 'vitest';
import { dayClosed, dayClosedLine, doneToday } from '@/lib/todo/agenda/day-close';
import type { AgendaPile } from '@/lib/todo/agenda/merge';
import type { Task } from '@/lib/todo/tasks/model';

/** The day closing on the agenda (plan #1556). */

const NOW = new Date('2026-03-10T15:00:00.000Z');
const TZ = 'Europe/London';

function task(over: Partial<Task>): Task {
  return {
    id: 'task',
    title: 'A task',
    body: null,
    status: 'done',
    dueOn: '2026-03-10',
    dueAt: null,
    pinned: false,
    snoozedUntil: null,
    completedAt: '2026-03-10T09:00:00.000Z',
    createdAt: '2026-03-01T09:00:00.000Z',
    position: null,
    parentId: null,
    ...over,
  };
}

function pile(bucket: AgendaPile['bucket'], entries = 1): AgendaPile {
  return {
    bucket,
    entries: Array.from(
      { length: entries },
      (_, i) => ({ key: `${bucket}-${i}`, kind: 'task' }) as never,
    ),
    context: [],
  };
}

describe('doneToday', () => {
  it('keeps the whole tasks finished today that were due by today, last ticked first', () => {
    const done = doneToday(
      [
        task({ id: 'today', completedAt: '2026-03-10T09:00:00.000Z' }),
        task({ id: 'late', dueOn: '2026-03-02', completedAt: '2026-03-10T11:00:00.000Z' }),
        task({ id: 'clock', dueOn: null, dueAt: '2026-03-10T17:00:00.000Z' }),
        task({ id: 'undated', dueOn: null }),
        task({ id: 'tomorrow', dueOn: '2026-03-11' }),
        task({ id: 'yesterday', completedAt: '2026-03-09T20:00:00.000Z' }),
        task({ id: 'item', parentId: 'today' }),
        task({ id: 'open', status: 'open', completedAt: null }),
      ],
      TZ,
      NOW,
    );
    expect(done.map((t) => t.id)).toEqual(['late', 'today', 'clock']);
  });

  it('reads today in the account zone, not UTC', () => {
    // 23:30 on the 9th in New York is the 10th in UTC.
    const late = new Date('2026-03-10T03:30:00.000Z');
    const done = doneToday(
      [task({ dueOn: '2026-03-09', completedAt: '2026-03-10T02:00:00.000Z' })],
      'America/New_York',
      late,
    );
    expect(done).toHaveLength(1);
  });
});

describe('dayClosed', () => {
  const done = [{ id: 'a', title: 'A' }];

  it('is closed once nothing is left under Overdue and Today', () => {
    expect(dayClosed([pile('soon'), pile('undated')], done)).toBe(true);
    expect(dayClosed([], done)).toBe(true);
  });

  it('stays open while something is due by today', () => {
    expect(dayClosed([pile('today')], done)).toBe(false);
    expect(dayClosed([pile('overdue')], done)).toBe(false);
  });

  it('is a quiet day, not a closed one, when nothing due was finished', () => {
    expect(dayClosed([], [])).toBe(false);
  });

  it('treats a today pile holding only appointments as empty', () => {
    expect(dayClosed([pile('today', 0)], done)).toBe(true);
  });
});

describe('dayClosedLine', () => {
  it('names the count', () => {
    expect(dayClosedLine(1)).toBe('You finished the one thing due today.');
    expect(dayClosedLine(4)).toBe('You finished all 4 things due today.');
  });
});
