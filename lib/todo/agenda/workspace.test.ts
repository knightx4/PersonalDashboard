import { describe, expect, it } from 'vitest';
import type { ModuleId } from '@/lib/modules';
import { mergeAgenda } from '@/lib/todo/agenda/merge';
import type { AgendaItem, SourceId } from '@/lib/todo/agenda/sources';
import {
  AGENDA_INBOXES,
  entryRef,
  homeInboxEntries,
  inboxEntries,
  itemWorkspace,
} from '@/lib/todo/agenda/workspace';
import type { Task } from '@/lib/todo/tasks/model';

const NOW = new Date('2026-03-10T09:00:00.000Z');

const MODULES: Record<string, ModuleId> = {
  job_reminders: 'jobs',
  return_deadlines: 'shopping',
  drafts: 'todo',
  threads: 'todo',
  raised: 'todo',
};
const moduleOf = (id: SourceId): ModuleId => MODULES[id] ?? 'todo';

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
    ref: 'job_search.reminders:r1',
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

const items: AgendaItem[] = [
  item(),
  item({ key: 'return:o1', source: 'return_deadlines', ref: 'public.orders:o1', title: 'Return the drill', day: '2026-03-12' }),
  item({ key: 'drafts:d1', source: 'drafts', ref: 'core.drafted_messages:d1', title: 'Ask for a refund', workspace: 'shopping' }),
  item({ key: 'drafts:d2', source: 'drafts', ref: 'core.drafted_messages:d2', title: 'Follow up', workspace: 'jobs', day: null }),
  item({ key: 'thread:n1', source: 'threads', ref: 'obsidian.notes:n1', title: 'Which folder?', day: null }),
  item({ key: 'thread:s1', source: 'threads', ref: 'news.issues:s1', title: 'Worth a summary?', day: null }),
  item({ key: 'thread:t9', source: 'threads', ref: 'todo.tasks:t9', title: 'Which shop?', day: null }),
];
const tasks: Task[] = [
  task({ id: 't1', title: 'Undated' }),
  task({ id: 't2', title: 'Dated', dueOn: '2026-03-11' }),
];

const piles = mergeAgenda({ tasks, items, dismissals: new Map(), timezone: 'UTC', now: NOW, horizonDays: 7 });

describe('itemWorkspace', () => {
  it('takes what the item says first', () => {
    expect(itemWorkspace(items[2], moduleOf)).toBe('shopping');
  });

  it('then the workspace of its row’s table', () => {
    expect(itemWorkspace(items[1], moduleOf)).toBe('shopping');
    expect(itemWorkspace(items[4], moduleOf)).toBe('vault');
    expect(itemWorkspace(items[5], moduleOf)).toBe('news');
  });

  it('then the source’s, for a table in no workspace', () => {
    expect(itemWorkspace(item({ ref: 'core.drafted_messages:x', source: 'drafts' }), moduleOf)).toBe('todo');
  });
});

describe('inboxEntries', () => {
  const titles = (ws: (typeof AGENDA_INBOXES)[number]) =>
    inboxEntries(piles, ws, moduleOf).map((e) => e.task?.title ?? e.item?.title);

  it('lists a workspace’s rows, dated and undated', () => {
    expect(titles('shopping')).toEqual(['Ask for a refund', 'Return the drill']);
    expect(titles('jobs')).toEqual(['Follow up with Acme', 'Follow up']);
    expect(titles('vault')).toEqual(['Which folder?']);
    expect(titles('news')).toEqual(['Worth a summary?']);
    expect(titles('learn')).toEqual([]);
  });

  it('gives Todo only the undated pile', () => {
    expect(titles('todo')).toEqual(expect.arrayContaining(['Undated', 'Which shop?']));
    expect(titles('todo')).not.toContain('Dated');
  });

  it('puts no row in two Inboxes', () => {
    const refs = AGENDA_INBOXES.flatMap((ws) => inboxEntries(piles, ws, moduleOf).map(entryRef));
    expect(new Set(refs).size).toBe(refs.length);
  });

  it('lists a row two sources found once', () => {
    const twice = mergeAgenda({
      tasks: [],
      items: [item(), item({ key: 'other:r1', source: 'threads' })],
      dismissals: new Map(),
      timezone: 'UTC',
      now: NOW,
      horizonDays: 7,
    });
    expect(inboxEntries(twice, 'jobs', moduleOf)).toHaveLength(1);
  });

  it('leaves out what the agenda’s dismissals hide', () => {
    const hidden = mergeAgenda({
      tasks: [],
      items,
      dismissals: new Map([['return:o1', { until: null }]]),
      timezone: 'UTC',
      now: NOW,
      horizonDays: 7,
    });
    expect(inboxEntries(hidden, 'shopping', moduleOf).map((e) => e.item?.title)).toEqual(['Ask for a refund']);
  });
});

describe('homeInboxEntries', () => {
  const home = homeInboxEntries(piles, moduleOf);

  it('is every workspace’s Inbox at once, each row once', () => {
    const union = AGENDA_INBOXES.flatMap((ws) => inboxEntries(piles, ws, moduleOf).map(entryRef));
    expect(home.map((row) => entryRef(row.entry)).sort()).toEqual([...union].sort());
  });

  it('groups each row under its own workspace', () => {
    const where = Object.fromEntries(
      home.map((row) => [row.entry.task?.title ?? row.entry.item?.title, row.workspace]),
    );
    expect(where['Return the drill']).toBe('shopping');
    expect(where['Follow up']).toBe('jobs');
    expect(where['Undated']).toBe('todo');
    expect(where['Dated']).toBeUndefined();
  });

  it('keeps a Dev or Goals row, which no agenda Inbox lists', () => {
    const raised = mergeAgenda({
      tasks: [],
      items: [
        item({ key: 'raised:r1', source: 'raised', ref: 'public.raised_items:r1', title: 'Which key?', day: null, workspace: 'dev' }),
        item({ key: 'raised:r2', source: 'raised', ref: 'public.raised_items:r2', title: 'Off track?', day: null, workspace: 'goals' }),
      ],
      dismissals: new Map(),
      timezone: 'UTC',
      now: NOW,
      horizonDays: 7,
    });
    expect(homeInboxEntries(raised, moduleOf).map((row) => row.workspace).sort()).toEqual(['dev', 'goals']);
  });
});
