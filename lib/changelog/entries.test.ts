import { describe, expect, it } from 'vitest';
import type { FeedbackRow, FeedbackStatus } from '@/lib/feedback/load';
import type { PlanItem, PlanStatus } from '@/lib/plan/load';
import {
  buildChangelog,
  moduleForPath,
  noteEntries,
  planEntries,
} from '@/lib/changelog/entries';

let counter = 0;

function step(over: Partial<PlanItem> & { id: string }): PlanItem {
  counter += 1;
  return {
    number: counter,
    module: 'shopping',
    parentId: null,
    title: `Step ${over.id}`,
    detail: null,
    acceptance: null,
    status: 'done',
    kind: 'build',
    fog: null,
    resolution: null,
    comment: null,
    priority: 2,
    size: null,
    assignee: null,
    commitSha: null,
    position: counter * 10,
    startedAt: null,
    completedAt: '2026-03-02T09:00:00Z',
    createdAt: '2026-01-01T00:00:00Z',
    ...over,
  };
}

function note(over: Partial<FeedbackRow> & { id: string }): FeedbackRow {
  return {
    kind: 'bug',
    body: `Note ${over.id}`,
    pagePath: null,
    status: 'done',
    priority: 2,
    resolutionNote: null,
    commitSha: null,
    createdAt: '2026-01-01T00:00:00Z',
    completedAt: '2026-03-02T09:00:00Z',
    ...over,
  };
}

const closedAt = (id: string, at: string | null, over: Partial<PlanItem> = {}) =>
  step({ id, completedAt: at, ...over });

describe('planEntries', () => {
  it('carries what a line needs from a closed step', () => {
    const [entry] = planEntries([
      step({
        id: 'a',
        number: 42,
        module: 'dev',
        title: 'The changelog reading',
        detail: 'Pure and tested.',
        commitSha: 'abc1234',
        completedAt: '2026-03-02T09:00:00Z',
      }),
    ]);

    expect(entry).toMatchObject({
      source: 'plan',
      id: 'a',
      number: 42,
      at: '2026-03-02T09:00:00Z',
      day: '2026-03-02',
      module: 'dev',
      title: 'The changelog reading',
      detail: 'Pure and tested.',
      commitSha: 'abc1234',
    });
  });

  it('leaves out every step that did not ship', () => {
    const unshipped: PlanStatus[] = [
      'proposed',
      'not_started',
      'in_progress',
      'blocked',
      'dropped',
    ];
    const items = unshipped.map((status, index) => step({ id: `s${index}`, status }));

    expect(planEntries(items)).toEqual([]);
  });

  it('leaves out a dropped step even though it closed', () => {
    const entries = planEntries([
      step({ id: 'kept' }),
      step({ id: 'dropped', status: 'dropped' }),
    ]);

    expect(entries.map((entry) => entry.id)).toEqual(['kept']);
  });

  it('leaves out a done step with no completion stamp', () => {
    const entries = planEntries([closedAt('stamped', '2026-03-02T09:00:00Z'), closedAt('bare', null)]);

    expect(entries.map((entry) => entry.id)).toEqual(['stamped']);
  });
});

describe('noteEntries', () => {
  it('carries the resolution note and the workspace it was filed from', () => {
    const [entry] = noteEntries([
      note({
        id: 'n1',
        body: 'The spend chart shows last month twice',
        pagePath: '/shopping/dashboard',
        resolutionNote: 'The window was inclusive at both ends.',
        commitSha: 'def5678',
        completedAt: '2026-03-01T17:30:00Z',
      }),
    ]);

    expect(entry).toMatchObject({
      source: 'note',
      id: 'n1',
      number: null,
      day: '2026-03-01',
      module: 'shopping',
      title: 'The spend chart shows last month twice',
      detail: 'The window was inclusive at both ends.',
      commitSha: 'def5678',
    });
  });

  it('leaves out every note that was not fixed', () => {
    const unfixed: FeedbackStatus[] = ['open', 'in_progress', 'blocked', 'planned', 'declined'];
    const rows = unfixed.map((status, index) => note({ id: `n${index}`, status }));

    expect(noteEntries(rows)).toEqual([]);
  });

  it('leaves out a declined note even though it closed', () => {
    const entries = noteEntries([
      note({ id: 'fixed' }),
      note({ id: 'declined', status: 'declined' }),
    ]);

    expect(entries.map((entry) => entry.id)).toEqual(['fixed']);
  });

  it('leaves out a fixed note with no completion stamp', () => {
    const entries = noteEntries([note({ id: 'bare', completedAt: null })]);

    expect(entries).toEqual([]);
  });
});

describe('moduleForPath', () => {
  it('reads the workspace off the path', () => {
    expect(moduleForPath('/jobs/today')).toBe('jobs');
    expect(moduleForPath('/dev')).toBe('dev');
  });

  it('is null for a path outside every workspace, and for no path at all', () => {
    expect(moduleForPath('/account/settings')).toBeNull();
    expect(moduleForPath(null)).toBeNull();
  });

  it('does not mistake a longer segment for a prefix', () => {
    expect(moduleForPath('/todoist')).toBeNull();
  });
});

describe('buildChangelog', () => {
  it('groups both lists into days, newest first', () => {
    const days = buildChangelog({
      plan: [
        step({ id: 'old', completedAt: '2026-03-01T08:00:00Z' }),
        step({ id: 'new', completedAt: '2026-03-03T08:00:00Z' }),
      ],
      notes: [note({ id: 'middle', completedAt: '2026-03-02T08:00:00Z' })],
    });

    expect(days.map((day) => day.day)).toEqual(['2026-03-03', '2026-03-02', '2026-03-01']);
    expect(days[1].entries.map((entry) => entry.id)).toEqual(['middle']);
  });

  it('puts the newest entry first within a day, whichever list it came from', () => {
    const days = buildChangelog({
      plan: [
        step({ id: 'morning', completedAt: '2026-03-02T09:00:00Z' }),
        step({ id: 'evening', completedAt: '2026-03-02T21:00:00Z' }),
      ],
      notes: [note({ id: 'noon', completedAt: '2026-03-02T12:00:00Z' })],
    });

    expect(days).toHaveLength(1);
    expect(days[0].entries.map((entry) => entry.id)).toEqual(['evening', 'noon', 'morning']);
  });

  it('has no day for a date nothing shipped on', () => {
    const days = buildChangelog({
      plan: [
        step({ id: 'a', completedAt: '2026-03-05T08:00:00Z' }),
        step({ id: 'b', completedAt: '2026-03-01T08:00:00Z' }),
      ],
      notes: [],
    });

    expect(days.map((day) => day.day)).toEqual(['2026-03-05', '2026-03-01']);
  });

  it('is empty when nothing has shipped', () => {
    expect(buildChangelog({ plan: [step({ id: 'a', status: 'in_progress' })], notes: [] })).toEqual(
      [],
    );
    expect(buildChangelog({ plan: [], notes: [] })).toEqual([]);
  });

  it('gives every entry a key unique across both lists', () => {
    const shared = 'same-uuid';
    const days = buildChangelog({
      plan: [step({ id: shared })],
      notes: [note({ id: shared })],
    });
    const keys = days.flatMap((day) => day.entries.map((entry) => entry.key));

    expect(new Set(keys).size).toBe(keys.length);
  });
});
