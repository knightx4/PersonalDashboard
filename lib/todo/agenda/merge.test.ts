import { describe, expect, it } from 'vitest';
import { mergeAgenda, stillHidden } from '@/lib/todo/agenda/merge';
import type { AgendaItem } from '@/lib/todo/agenda/sources';
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

function merge(over: Partial<Parameters<typeof mergeAgenda>[0]> = {}) {
  return mergeAgenda({
    tasks: [],
    items: [],
    dismissals: new Map(),
    timezone: 'UTC',
    now: NOW,
    horizonDays: 7,
    ...over,
  });
}

describe('stillHidden', () => {
  it('hides for good when there is no date', () => {
    expect(stillHidden({ until: null }, NOW)).toBe(true);
  });

  it('hides until the date, then stops', () => {
    expect(stillHidden({ until: '2026-03-17T00:00:00.000Z' }, NOW)).toBe(true);
    expect(stillHidden({ until: '2026-03-09T00:00:00.000Z' }, NOW)).toBe(false);
  });

  it('hides nothing that was never dismissed', () => {
    expect(stillHidden(undefined, NOW)).toBe(false);
  });
});

describe('mergeAgenda', () => {
  it('puts tasks and source items in the same piles', () => {
    const piles = merge({
      tasks: [task({ id: 'a', dueOn: '2026-03-10' })],
      items: [item({ key: 'k1', day: '2026-03-10' })],
    });

    expect(piles).toHaveLength(1);
    expect(piles[0].bucket).toBe('today');
    expect(piles[0].entries.map((e) => e.kind)).toEqual(['task', 'item']);
  });

  it('leaves out a source item that is still dismissed', () => {
    const piles = merge({
      items: [item({ key: 'k1' }), item({ key: 'k2', title: 'Other' })],
      dismissals: new Map([['k1', { until: null }]]),
    });

    expect(piles[0].entries).toHaveLength(1);
    expect(piles[0].entries[0].item?.title).toBe('Other');
  });

  it('brings back an item whose deferral has run out', () => {
    const piles = merge({
      items: [item({ key: 'k1' })],
      dismissals: new Map([['k1', { until: '2026-03-09T00:00:00.000Z' }]]),
    });

    expect(piles[0].entries).toHaveLength(1);
  });

  it('never hides one of your own tasks because of a source dismissal', () => {
    // The keys live in different namespaces on purpose. A collision here would
    // silently delete something you wrote.
    const piles = merge({
      tasks: [task({ id: 'k1', dueOn: '2026-03-10' })],
      dismissals: new Map([['k1', { until: null }]]),
    });

    expect(piles[0].entries.map((e) => e.kind)).toEqual(['task']);
  });

  it('respects the horizon when deciding what is "soon"', () => {
    const short = merge({
      items: [item({ key: 'k', day: '2026-03-14' })],
      horizonDays: 2,
    });
    const long = merge({
      items: [item({ key: 'k', day: '2026-03-14' })],
      horizonDays: 7,
    });

    expect(short[0].bucket).toBe('later');
    expect(long[0].bucket).toBe('soon');
  });

  it('reads the day boundary in the reader\'s zone', () => {
    const evening = new Date('2026-03-10T20:00:00.000Z');
    const utc = merge({ items: [item({ day: '2026-03-10' })], now: evening });
    const tokyo = merge({
      items: [item({ day: '2026-03-10' })],
      now: evening,
      timezone: 'Asia/Tokyo',
    });

    expect(utc[0].bucket).toBe('today');
    expect(tokyo[0].bucket).toBe('overdue');
  });

  it('puts pinned first, then the clock, then yours before theirs', () => {
    const piles = merge({
      tasks: [
        task({ id: 'plain', dueOn: '2026-03-10', title: 'Plain' }),
        task({ id: 'pin', dueOn: '2026-03-10', pinned: true, title: 'Pinned' }),
        task({ id: 'timed', dueAt: '2026-03-10T08:00:00.000Z', title: 'Timed' }),
      ],
      items: [item({ key: 'k', day: '2026-03-10', title: 'From a source' })],
    });

    expect(piles[0].entries.map((e) => e.task?.title ?? e.item?.title)).toEqual([
      'Pinned',
      'Timed',
      'Plain',
      'From a source',
    ]);
  });

  it('omits an empty pile rather than showing a zero', () => {
    expect(merge({ tasks: [task({ dueOn: '2026-03-10' })] }).map((p) => p.bucket)).toEqual([
      'today',
    ]);
  });

  it('says nothing at all when there is nothing at all', () => {
    expect(merge()).toEqual([]);
  });

  it('shows a day that holds only an appointment', () => {
    // "You have an interview on Thursday and nothing else" is an answer. An
    // empty Thursday that silently omits the interview is not.
    const piles = merge({
      context: [
        {
          key: 'interview:1',
          day: '2026-03-12',
          at: '2026-03-12T14:00:00.000Z',
          label: 'Acme · Staff Engineer',
          detail: 'screen · 45 min',
          link: null,
        },
      ],
    });

    expect(piles).toHaveLength(1);
    expect(piles[0].bucket).toBe('soon');
    expect(piles[0].entries).toEqual([]);
    expect(piles[0].context.map((c) => c.label)).toEqual(['Acme · Staff Engineer']);
  });

  it('files an appointment into the same pile a task on that day would get', () => {
    const piles = merge({
      tasks: [task({ id: 'a', dueOn: '2026-03-10' })],
      context: [
        {
          key: 'interview:1',
          day: '2026-03-10',
          at: '2026-03-10T14:00:00.000Z',
          label: 'Acme',
          detail: null,
          link: null,
        },
      ],
    });

    expect(piles).toHaveLength(1);
    expect(piles[0].entries).toHaveLength(1);
    expect(piles[0].context).toHaveLength(1);
  });

  it('never gives an appointment a checkbox by turning it into an entry', () => {
    const piles = merge({
      context: [
        { key: 'i', day: '2026-03-10', at: null, label: 'Acme', detail: null, link: null },
      ],
    });

    expect(piles[0].entries).toEqual([]);
  });

  it('drops an appointment that has already happened rather than calling it overdue', () => {
    // The source window reaches a year back so a late reminder cannot hide.
    // Every interview already attended came back with it, under a red
    // "Overdue" heading. You cannot be late for a meeting you have been to.
    const piles = merge({
      context: [
        {
          key: 'interview:old',
          day: '2026-01-14',
          at: '2026-01-14T14:00:00.000Z',
          label: 'Acme · Staff Engineer',
          detail: null,
          link: null,
        },
      ],
    });

    expect(piles).toEqual([]);
  });

  it('still shows today’s appointment, which is not in the past', () => {
    const piles = merge({
      context: [
        { key: 'i', day: '2026-03-10', at: null, label: 'Acme', detail: null, link: null },
      ],
    });

    expect(piles).toHaveLength(1);
    expect(piles[0].bucket).toBe('today');
  });

  it('keeps a genuinely late task in the overdue pile', () => {
    // The rule is about appointments only: an overdue reminder from last month
    // is still the most important thing on the page.
    const piles = merge({ tasks: [task({ id: 'late', dueOn: '2026-02-01' })] });
    expect(piles[0].bucket).toBe('overdue');
  });

  it('files an item with no day under someday, not under overdue', () => {
    // Sources always give a day today, but a future one might not, and
    // "unknown" must never present as "late".
    const piles = merge({ tasks: [task({ id: 'x' })] });
    expect(piles[0].bucket).toBe('someday');
  });

  it('puts a hand-placed pile in the order it was placed in', () => {
    const piles = merge({
      tasks: [
        task({ id: 'c', dueOn: '2026-03-10', position: 3 }),
        task({ id: 'a', dueOn: '2026-03-10', position: 1 }),
        task({ id: 'b', dueAt: '2026-03-10T08:00:00.000Z', position: 2 }),
      ],
    });

    expect(piles[0].entries.map((entry) => entry.task?.id)).toEqual(['a', 'b', 'c']);
  });

  it('leaves a source item below the tasks you placed, having nowhere to place it', () => {
    // A reminder or an interview is another workspace's row: there is no
    // column here to write an order to, so it sorts as unplaced.
    const piles = merge({
      tasks: [task({ id: 'placed', dueOn: '2026-03-10', position: 1 })],
      items: [item({ key: 'k1', day: '2026-03-10', at: '2026-03-10T07:00:00.000Z' })],
    });

    expect(piles[0].entries.map((entry) => entry.key)).toEqual(['task:placed', 'item:k1']);
  });

  it('orders an unplaced pile exactly as it did before', () => {
    const piles = merge({
      tasks: [
        task({ id: 'noon', dueAt: '2026-03-10T12:00:00.000Z' }),
        task({ id: 'pinned', dueOn: '2026-03-10', pinned: true }),
        task({ id: 'dawn', dueAt: '2026-03-10T06:00:00.000Z' }),
      ],
    });

    expect(piles[0].entries.map((entry) => entry.task?.id)).toEqual(['pinned', 'dawn', 'noon']);
  });
});
