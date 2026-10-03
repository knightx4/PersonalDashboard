import { describe, expect, it } from 'vitest';
import { mergeAgenda } from '@/lib/todo/agenda/merge';
import { todayEntries, todaySlice } from '@/lib/todo/agenda/today';
import type { AgendaItem, DayContext } from '@/lib/todo/agenda/sources';
import type { Task } from '@/lib/todo/tasks/model';

/**
 * Home's Today and the Todo list over one fixture (plan #1476).
 *
 * The Todo page draws every pile mergeAgenda returns, under its bucket's
 * heading; its "today" is what sits under Overdue and Today. Home's Today is
 * todaySlice over the same piles. The fixture holds one of everything that
 * could make the two disagree: something late, something today, something
 * soon, later and undated, a dismissed item, a snoozed task, a child task,
 * and appointments today, yesterday and this week.
 */

const NOW = new Date('2026-03-10T09:00:00.000Z');

function task(over: Partial<Task>): Task {
  return {
    id: 'task',
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

function item(over: Partial<AgendaItem>): AgendaItem {
  return {
    key: 'job_reminders:r',
    source: 'job_reminders',
    ref: 'job_search.reminders:r',
    title: 'A reminder',
    day: '2026-03-10',
    at: null,
    link: null,
    action: null,
    detail: null,
    completable: true,
    ...over,
  };
}

function context(over: Partial<DayContext>): DayContext {
  return {
    key: 'event:e',
    ref: 'todo.events:e',
    day: '2026-03-10',
    at: null,
    label: 'An event',
    detail: null,
    link: null,
    ...over,
  };
}

const FIXTURE = mergeAgenda({
  tasks: [
    task({ id: 'late', title: 'Late task', dueOn: '2026-03-08' }),
    task({ id: 'today', title: 'Task today', dueOn: '2026-03-10' }),
    task({ id: 'pinned', title: 'Pinned today', dueOn: '2026-03-10', pinned: true }),
    task({ id: 'child', title: 'Under today', dueOn: '2026-03-10', parentId: 'today' }),
    task({ id: 'snoozed', title: 'Snoozed', dueOn: '2026-03-10', snoozedUntil: '2026-03-12T00:00:00.000Z' }),
    task({ id: 'soon', title: 'Soon task', dueOn: '2026-03-12' }),
    task({ id: 'someday', title: 'No date task' }),
  ],
  items: [
    item({ key: 'job_reminders:old', title: 'Old reminder', day: '2026-02-20' }),
    item({ key: 'job_reminders:now', title: 'Reminder today', day: '2026-03-10' }),
    item({ key: 'job_reminders:gone', title: 'Dismissed today', day: '2026-03-10' }),
    item({ key: 'plan_steps:s1', source: 'plan_steps', title: 'Plan step on you', day: null }),
    item({ key: 'raised:r1', source: 'raised', title: 'A question for you', day: null }),
    item({ key: 'job_reminders:far', title: 'Far reminder', day: '2026-05-01' }),
  ],
  context: [
    context({ key: 'event:today', label: 'Dentist', at: '2026-03-10T14:00:00.000Z' }),
    context({ key: 'event:past', label: 'Yesterday', day: '2026-03-09' }),
    context({ key: 'event:soon', label: 'Interview', day: '2026-03-11' }),
  ],
  dismissals: new Map([['job_reminders:gone', { until: null }]]),
  timezone: 'UTC',
  now: NOW,
  horizonDays: 7,
});

/** What the Todo page draws under its Overdue and Today headings. */
function todoListToday() {
  return FIXTURE.filter((pile) => pile.bucket === 'overdue' || pile.bucket === 'today').flatMap(
    (pile) => pile.entries.map((entry) => entry.key),
  );
}

describe("Home's Today and the Todo list", () => {
  it('return the same items for today, in the same order', () => {
    const home = todaySlice(FIXTURE, Infinity);
    expect(home.due.map(({ entry }) => entry.key)).toEqual(todoListToday());
    expect(home.more).toBe(0);
    expect(todoListToday()).toEqual([
      'item:job_reminders:old',
      'task:late',
      'task:pinned',
      'task:today',
      'item:job_reminders:now',
    ]);
  });

  it("show the same appointments for today, and only today's", () => {
    const todoContext = FIXTURE.filter((pile) => pile.bucket === 'today').flatMap((pile) => pile.context);
    expect(todaySlice(FIXTURE).happening).toEqual(todoContext);
    expect(todoContext.map((entry) => entry.label)).toEqual(['Dentist']);
  });

  it('keep the five-item cap, with the rest counted', () => {
    const home = todaySlice(FIXTURE, 3);
    expect(home.due.map(({ entry }) => entry.key)).toEqual(todoListToday().slice(0, 3));
    expect(home.more).toBe(2);
  });

  it('leave the undated pile on the Todo list only', () => {
    const keys = todayEntries(FIXTURE).map(({ entry }) => entry.key);
    expect(keys).not.toContain('item:plan_steps:s1');
    expect(keys).not.toContain('task:someday');
    const undated = FIXTURE.find((pile) => pile.bucket === 'undated');
    expect(undated?.entries.map((entry) => entry.key)).toContain('item:plan_steps:s1');
  });

  it('carry the overdue bucket so Home can mark it', () => {
    expect(todaySlice(FIXTURE).due.filter(({ bucket }) => bucket === 'overdue')).toHaveLength(2);
  });
});
