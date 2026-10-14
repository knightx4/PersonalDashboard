import { describe, expect, it } from 'vitest';
import { agendaInboxRow, dueLine, itemSection, type AgendaInboxActions } from '@/lib/inbox/agenda-rows';
import { queueRow } from '@/lib/inbox/queue-rows';
import type { AgendaEntry } from '@/lib/todo/agenda/merge';
import type { AgendaItem } from '@/lib/todo/agenda/sources';

const noop = async () => undefined;
const ACTIONS: AgendaInboxActions = {
  done: noop,
  later: noop,
  decline: noop,
  answer: noop,
  doneTask: noop,
  laterTask: noop,
};
const ALL = { complete: true, defer: true, dismiss: true, answer: true };

function item(over: Partial<AgendaItem> = {}): AgendaItem {
  return {
    key: 'return:o1',
    source: 'return_deadlines',
    ref: 'public.orders:o1',
    title: 'Return the drill',
    day: '2026-03-12',
    at: null,
    link: { href: '/shopping/orders/o1', label: 'Open the order' },
    action: null,
    detail: 'Screwfix',
    completable: false,
    ...over,
  };
}

const entry = (i: AgendaItem): AgendaEntry => ({
  kind: 'item',
  key: i.key,
  item: i,
  children: [],
  openChildren: 0,
  totalChildren: 0,
});

describe('dueLine', () => {
  it('says today, a day ahead and a day gone by', () => {
    expect(dueLine('2026-03-10', '2026-03-10')).toBe('due today');
    expect(dueLine('2026-03-12', '2026-03-10')).toBe('due Thu 12 Mar');
    expect(dueLine('2026-03-01', '2026-03-10')).toBe('was due Sun 1 Mar');
    expect(dueLine(null, '2026-03-10')).toBeNull();
  });
});

describe('agendaInboxRow', () => {
  it('makes the link the main press when nothing can be finished here', () => {
    const row = agendaInboxRow(entry(item()), ACTIONS, { return_deadlines: { ...ALL, complete: false } }, '2026-03-10')!;
    expect(row.ref).toBe('public.orders:o1');
    expect(row.section).toBe('actions');
    expect(row.line).toBe('Screwfix · due Thu 12 Mar');
    expect(row.verbs?.map((v) => [v.label, v.tone])).toEqual([['Open the order', 'primary']]);
    expect(row.putOff?.fields).toEqual({ source: 'return_deadlines', key: 'return:o1' });
    expect(row.decline?.fields).toEqual({ source: 'return_deadlines', key: 'return:o1' });
  });

  it('puts Done first on something that can be finished, through its source', () => {
    const row = agendaInboxRow(
      entry(item({ source: 'job_reminders', key: 'job_reminders:r1', completable: true })),
      ACTIONS,
      { job_reminders: ALL },
      '2026-03-10',
    )!;
    expect(row.verbs?.[0]).toMatchObject({ label: 'Done', tone: 'primary' });
    expect(row.verbs?.[0].write?.fields).toEqual({ source: 'job_reminders', key: 'job_reminders:r1' });
  });

  it('offers no verb the source does not have', () => {
    const row = agendaInboxRow(entry(item()), ACTIONS, {}, '2026-03-10')!;
    expect(row.verbs?.map((v) => v.label)).toEqual(['Open the order']);
    expect(row.decline).toBeUndefined();
    expect(row.putOff).toBeUndefined();
  });

  it('answers a question with its options, under Questions', () => {
    const asked = item({
      source: 'goal_steps',
      options: [
        { letter: 'A', label: 'Yes', answer: 'A — Yes', recommended: true },
        { letter: 'B', label: 'No', answer: 'B — No', recommended: false },
      ],
    });
    expect(itemSection(asked)).toBe('questions');
    const row = agendaInboxRow(entry(asked), ACTIONS, { goal_steps: ALL }, '2026-03-10')!;
    expect(row.verbs?.slice(0, 2).map((v) => [v.label, v.tone, v.write?.fields?.answer])).toEqual([
      ['Yes', 'primary', 'A — Yes'],
      ['No', 'secondary', 'B — No'],
    ]);
  });

  it('gives a task Done and Later of its own', () => {
    const row = agendaInboxRow(
      {
        kind: 'task',
        key: 'task:t1',
        task: {
          id: 't1',
          title: 'Book the dentist',
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
        },
        children: [],
        openChildren: 1,
        totalChildren: 3,
      },
      ACTIONS,
      {},
      '2026-03-10',
    )!;
    expect(row.ref).toBe('todo.tasks:t1');
    expect(row.line).toBe('1 of 3 left');
    expect(row.verbs?.map((v) => [v.label, v.write?.fields])).toEqual([['Done', { id: 't1' }]]);
    expect(row.putOff?.fields).toEqual({ id: 't1' });
  });
});

describe('queueRow', () => {
  it('says how many and opens the queue’s page', () => {
    expect(queueRow('vault-triage', 3)).toMatchObject({
      title: '3 quick notes to file',
      href: '/vault/triage',
      verbs: [{ label: 'File them', href: '/vault/triage' }],
    });
    expect(queueRow('vault-triage', 1)?.title).toBe('1 quick note to file');
    expect(queueRow('shopping-review', 2)?.section).toBe('review');
  });

  it('is no row at all when the queue is empty', () => {
    expect(queueRow('learn-read-now', 0)).toBeNull();
  });
});
