import { describe, expect, it } from 'vitest';
import {
  addDays,
  bucketFor,
  bucketTasks,
  childrenByParent,
  dueDay,
  isSnoozed,
  openCount,
  resolveRelativeDay,
  todayIn,
  type Task,
} from '@/lib/todo/tasks/model';

function task(over: Partial<Task> = {}): Task {
  return {
    id: 'id',
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

/** 2026-03-10, mid-morning UTC. */
const NOW = new Date('2026-03-10T09:00:00.000Z');

describe('todayIn', () => {
  it('reads the day in the given zone, not the server\'s', () => {
    // 23:30 UTC is already tomorrow in Tokyo and still today in New York.
    const late = new Date('2026-03-10T23:30:00.000Z');
    expect(todayIn('UTC', late)).toBe('2026-03-10');
    expect(todayIn('Asia/Tokyo', late)).toBe('2026-03-11');
    expect(todayIn('America/New_York', late)).toBe('2026-03-10');
  });
});

describe('dueDay', () => {
  it('returns a due date exactly as written, whatever the zone', () => {
    // The whole reason due_on is a date. "Tuesday" must not become Monday
    // because the reader is in Los Angeles.
    const t = task({ dueOn: '2026-03-12' });
    expect(dueDay(t, 'Asia/Tokyo')).toBe('2026-03-12');
    expect(dueDay(t, 'America/Los_Angeles')).toBe('2026-03-12');
  });

  it('asks which day an instant falls on for this reader', () => {
    const t = task({ dueAt: '2026-03-12T23:30:00.000Z' });
    expect(dueDay(t, 'UTC')).toBe('2026-03-12');
    expect(dueDay(t, 'Asia/Tokyo')).toBe('2026-03-13');
  });

  it('has no day at all when nothing is set', () => {
    expect(dueDay(task(), 'UTC')).toBeNull();
  });
});

describe('bucketFor', () => {
  it('sorts a task into the pile its due day says', () => {
    expect(bucketFor(task({ dueOn: '2026-03-09' }), 'UTC', NOW)).toBe('overdue');
    expect(bucketFor(task({ dueOn: '2026-03-10' }), 'UTC', NOW)).toBe('today');
    expect(bucketFor(task({ dueOn: '2026-03-13' }), 'UTC', NOW)).toBe('soon');
    expect(bucketFor(task({ dueOn: '2026-03-17' }), 'UTC', NOW)).toBe('soon');
    expect(bucketFor(task({ dueOn: '2026-03-18' }), 'UTC', NOW)).toBe('later');
    expect(bucketFor(task(), 'UTC', NOW)).toBe('someday');
  });

  it('is overdue only against the reader\'s own day', () => {
    // 2026-03-10 in Tokyo is already over when it is still the 9th in UTC.
    const t = task({ dueOn: '2026-03-10' });
    const evening = new Date('2026-03-10T20:00:00.000Z');
    expect(bucketFor(t, 'UTC', evening)).toBe('today');
    expect(bucketFor(t, 'Asia/Tokyo', evening)).toBe('overdue');
  });

  it('does not confuse an instant earlier today with an overdue task', () => {
    // 08:00 has passed at 09:00, but the task is still due today, and a list
    // that files it under Overdue an hour later is lying about the day.
    expect(bucketFor(task({ dueAt: '2026-03-10T08:00:00.000Z' }), 'UTC', NOW)).toBe('today');
  });
});

describe('isSnoozed', () => {
  it('hides a task until its snooze runs out', () => {
    expect(isSnoozed(task({ snoozedUntil: '2026-03-11T00:00:00.000Z' }), NOW)).toBe(true);
    expect(isSnoozed(task({ snoozedUntil: '2026-03-10T08:00:00.000Z' }), NOW)).toBe(false);
    expect(isSnoozed(task(), NOW)).toBe(false);
  });
});

describe('bucketTasks', () => {
  it('leaves out anything finished, dropped or deferred', () => {
    const result = bucketTasks(
      [
        task({ id: 'open', dueOn: '2026-03-10' }),
        task({ id: 'done', status: 'done', dueOn: '2026-03-10' }),
        task({ id: 'dropped', status: 'dropped', dueOn: '2026-03-10' }),
        task({ id: 'snoozed', dueOn: '2026-03-10', snoozedUntil: '2026-03-20T00:00:00.000Z' }),
      ],
      { timezone: 'UTC', now: NOW },
    );

    expect(result).toHaveLength(1);
    expect(result[0].tasks.map((t) => t.id)).toEqual(['open']);
  });

  it('leaves out an item that sits under a task', () => {
    // It is shown under the task it belongs to, never as a row of its own.
    const result = bucketTasks(
      [task({ id: 'big', dueOn: '2026-03-10' }), task({ id: 'item', parentId: 'big', dueOn: '2026-03-10' })],
      { timezone: 'UTC', now: NOW },
    );

    expect(result[0].tasks.map((t) => t.id)).toEqual(['big']);
  });

  it('omits an empty pile rather than showing a zero', () => {
    const result = bucketTasks([task({ dueOn: '2026-03-10' })], { timezone: 'UTC', now: NOW });
    expect(result.map((r) => r.bucket)).toEqual(['today']);
  });

  it('puts the piles in the order they matter', () => {
    const result = bucketTasks(
      [
        task({ id: 'someday' }),
        task({ id: 'later', dueOn: '2026-04-01' }),
        task({ id: 'today', dueOn: '2026-03-10' }),
        task({ id: 'overdue', dueOn: '2026-01-01' }),
        task({ id: 'soon', dueOn: '2026-03-12' }),
      ],
      { timezone: 'UTC', now: NOW },
    );

    expect(result.map((r) => r.bucket)).toEqual(['overdue', 'today', 'soon', 'later', 'someday']);
  });

  it('puts pinned first, then the clock, then what came first', () => {
    const result = bucketTasks(
      [
        task({ id: 'later-today', dueAt: '2026-03-10T17:00:00.000Z' }),
        task({ id: 'no-clock', dueOn: '2026-03-10', createdAt: '2026-01-02T00:00:00.000Z' }),
        task({ id: 'earlier-written', dueOn: '2026-03-10', createdAt: '2026-01-01T00:00:00.000Z' }),
        task({ id: 'pinned', dueOn: '2026-03-10', pinned: true }),
        task({ id: 'this-morning', dueAt: '2026-03-10T08:00:00.000Z' }),
      ],
      { timezone: 'UTC', now: NOW },
    );

    expect(result[0].tasks.map((t) => t.id)).toEqual([
      'pinned',
      'this-morning',
      'later-today',
      'earlier-written',
      'no-clock',
    ]);
  });

  it('puts what you placed by hand first, in the order you placed it', () => {
    const result = bucketTasks(
      [
        task({ id: 'third', dueOn: '2026-03-10', position: 3 }),
        task({ id: 'unplaced', dueAt: '2026-03-10T08:00:00.000Z' }),
        task({ id: 'first', dueOn: '2026-03-10', position: 1 }),
        task({ id: 'second', dueOn: '2026-03-10', position: 2 }),
      ],
      { timezone: 'UTC', now: NOW },
    );

    expect(result[0].tasks.map((t) => t.id)).toEqual(['first', 'second', 'third', 'unplaced']);
  });

  it('lets a hand-placed order beat a pin, and a pin still floats the unplaced', () => {
    const result = bucketTasks(
      [
        task({ id: 'pinned-below', dueOn: '2026-03-10', pinned: true, position: 2 }),
        task({ id: 'placed-above', dueOn: '2026-03-10', position: 1 }),
        task({ id: 'unplaced-plain', dueOn: '2026-03-10', createdAt: '2026-01-01T00:00:00.000Z' }),
        task({ id: 'unplaced-pinned', dueOn: '2026-03-10', pinned: true }),
      ],
      { timezone: 'UTC', now: NOW },
    );

    expect(result[0].tasks.map((t) => t.id)).toEqual([
      'placed-above',
      'pinned-below',
      'unplaced-pinned',
      'unplaced-plain',
    ]);
  });
});

describe('childrenByParent', () => {
  it('keeps each task\u2019s items together, in the order they were written', () => {
    const result = childrenByParent([
      task({ id: 'a' }),
      task({ id: 'a2', parentId: 'a', createdAt: '2026-01-02T00:00:00.000Z' }),
      task({ id: 'b1', parentId: 'b', createdAt: '2026-01-01T00:00:00.000Z' }),
      task({ id: 'a1', parentId: 'a', createdAt: '2026-01-01T00:00:00.000Z' }),
    ]);

    expect(result.get('a')?.map((t) => t.id)).toEqual(['a1', 'a2']);
    expect(result.get('b')?.map((t) => t.id)).toEqual(['b1']);
  });

  it('ignores the position a drag would have written', () => {
    // Dragging renumbers a whole pile and a list under a task is not one, so
    // a position left over from somewhere else must not reorder the list.
    const result = childrenByParent([
      task({ id: 'second', parentId: 'a', position: 1, createdAt: '2026-01-02T00:00:00.000Z' }),
      task({ id: 'first', parentId: 'a', position: 9, createdAt: '2026-01-01T00:00:00.000Z' }),
    ]);

    expect(result.get('a')?.map((t) => t.id)).toEqual(['first', 'second']);
  });

  it('keeps a ticked item and leaves out a dropped one', () => {
    const result = childrenByParent([
      task({ id: 'done', parentId: 'a', status: 'done' }),
      task({ id: 'dropped', parentId: 'a', status: 'dropped' }),
    ]);

    expect(result.get('a')?.map((t) => t.id)).toEqual(['done']);
  });

  it('gives nothing for a task with no items', () => {
    expect(childrenByParent([task({ id: 'alone' })]).get('alone')).toBeUndefined();
  });
});

describe('openCount', () => {
  it('counts what is still to do, not what is on the list', () => {
    expect(
      openCount([task({ status: 'done' }), task({ status: 'open' }), task({ status: 'open' })]),
    ).toBe(2);
    expect(openCount([])).toBe(0);
  });
});

describe('addDays', () => {
  it('crosses a month and a leap day without drifting', () => {
    expect(addDays('2026-01-31', 1)).toBe('2026-02-01');
    expect(addDays('2024-02-28', 1)).toBe('2024-02-29');
    expect(addDays('2026-03-10', -1)).toBe('2026-03-09');
  });
});

describe('resolveRelativeDay', () => {
  it('turns the two words a form can send into the days they mean', () => {
    expect(resolveRelativeDay('today', '2026-03-10')).toBe('2026-03-10');
    expect(resolveRelativeDay('tomorrow', '2026-03-10')).toBe('2026-03-11');
    expect(resolveRelativeDay('tomorrow', '2026-12-31')).toBe('2027-01-01');
  });

  it('leaves a date alone, so a form that knows the day still sends one', () => {
    expect(resolveRelativeDay('2026-03-10', '2026-06-01')).toBe('2026-03-10');
  });

  it('leaves anything else alone, rather than reading it as a day', () => {
    // Not resolving it is what sends it to the date validation, which is the
    // one place that decides whether a due date is a due date.
    expect(resolveRelativeDay('yesterday', '2026-03-10')).toBe('yesterday');
    expect(resolveRelativeDay('', '2026-03-10')).toBe('');
  });
});
