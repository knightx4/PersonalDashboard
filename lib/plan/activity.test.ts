import { describe, expect, it } from 'vitest';
import type { PlanItem } from '@/lib/plan/load';
import { buildPlanTree, type PlanNode } from '@/lib/plan/tree';
import type { PlanUpdate } from '@/lib/plan/updates';
import { activityDays, datedLines, dayHeading, featureActivity, stepIdFromRef } from './activity';

function item(over: Partial<PlanItem> & { id: string; title: string; number: number }): PlanItem {
  return {
    module: 'dev',
    parentId: null,
    detail: null,
    acceptance: null,
    status: 'not_started',
    kind: 'build',
    track: 'feature',
    fog: null,
    resolution: null,
    dismissedAt: null,
    fogDismissedAt: null,
    comment: null,
    blockAsk: null,
    blockKind: null,
    thread: [],
    priority: 2,
    size: null,
    assignee: null,
    commitSha: null,
    position: over.number * 10,
    startedAt: null,
    completedAt: null,
    createdAt: '2026-10-01T09:00:00Z',
    updatedAt: '2026-10-01T09:00:00Z',
    ...over,
  };
}

function feature(items: PlanItem[]): PlanNode {
  const sections = buildPlanTree({ items, dependencies: [] });
  const node = sections.flatMap((section) => section.nodes).find((top) => top.id === 'f');
  if (!node) throw new Error('no feature');
  return node;
}

const update: PlanUpdate = {
  id: 'u1',
  featureId: 'f',
  health: 'on_track',
  body: 'Two steps closed.',
  stepsDoneBefore: 0,
  stepsDoneAfter: 1,
  stepsTotal: 3,
  session: null,
  createdAt: '2026-10-03T12:00:00Z',
};

describe('datedLines', () => {
  it('reads dated lines, joins their continuations and skips the stamp', () => {
    expect(
      datedLines(
        'Added by session cse_1 on 2026-10-01.\n\nDone 2026-10-02: Closed it.\nSecond line.\nClaim expired 2026-10-03 14:02: nobody pushed.',
      ),
    ).toEqual([
      { verb: 'Done', date: '2026-10-02', text: 'Closed it.\nSecond line.' },
      { verb: 'Claim expired', date: '2026-10-03', text: 'nobody pushed.' },
    ]);
  });
});

describe('featureActivity', () => {
  const f = feature([
    item({ id: 'f', number: 10, title: 'Feature pages' }),
    item({
      id: 's1',
      number: 11,
      parentId: 'f',
      title: 'Overview',
      status: 'done',
      commitSha: 'abcdef1234',
      startedAt: '2026-10-02T08:00:00Z',
      completedAt: '2026-10-02T09:00:00Z',
      comment:
        'Added by session cse_1 on 2026-10-01.\n\nBlocked 2026-10-01: which layout?\n\nDone 2026-10-02: The page opens.',
      thread: [{ id: 't', author: 'me', body: 'Looks right.', createdAt: '2026-10-02T10:00:00Z' }],
    }),
    item({
      id: 'q',
      number: 12,
      parentId: 'f',
      kind: 'decision',
      title: 'Which layout?',
      status: 'done',
      resolution: 'B — tabbed detail',
      completedAt: '2026-10-01T18:00:00Z',
      comment: 'Answered 2026-10-01: B — tabbed detail',
    }),
    item({
      id: 's2',
      number: 13,
      parentId: 'f',
      title: 'Goal page',
      status: 'blocked',
      blockKind: 'outside',
      blockAsk: 'Which parts go where?',
      startedAt: '2026-10-03T08:00:00Z',
    }),
  ]);

  const entries = featureActivity(f, {
    blockedAt: { s2: '2026-10-03T09:00:00Z' },
    updates: [update],
    runs: [
      {
        id: 'r',
        stepId: 's2',
        job: 'step',
        status: 'failed',
        error: 'Ended without closing.',
        createdAt: '2026-10-03T07:59:00Z',
      },
      { id: 'x', stepId: 'elsewhere', job: 'step', status: 'finished', error: null, createdAt: '2026-10-03T07:00:00Z' },
    ],
    actions: [
      { id: 'a1', stepId: 's1', kind: 'close_step', summary: 'Dash closed step #11.', createdAt: '2026-10-02T09:00:03Z' },
      { id: 'a2', stepId: 'f', kind: 'set_priority', summary: 'Dash raised the priority.', createdAt: '2026-10-03T13:00:00Z' },
    ],
  });

  it('lists newest first', () => {
    const times = entries.map((entry) => Date.parse(entry.at));
    expect(times).toEqual([...times].sort((a, b) => b - a));
    expect(entries[0].kind).toBe('dash');
  });

  it('puts the close note and the commit on the close, marked as Dash’s', () => {
    const closed = entries.find((entry) => entry.kind === 'closed');
    expect(closed).toMatchObject({
      at: '2026-10-02T09:00:00Z',
      detail: 'The page opens.',
      sha: 'abcdef1234',
      who: 'dash',
      subject: { number: 11, href: '/dev/plan/10?tab=steps#plan-11' },
    });
    // The Dash action that says the same thing is not listed again.
    expect(entries.filter((entry) => entry.kind === 'dash')).toHaveLength(1);
  });

  it('keeps a block the columns have forgotten, by its day', () => {
    const earlier = entries.find((entry) => entry.kind === 'blocked' && entry.subject.number === 11);
    expect(earlier).toMatchObject({ dayOnly: true, detail: 'which layout?' });
    const now = entries.find((entry) => entry.kind === 'blocked' && entry.subject.number === 13);
    expect(now).toMatchObject({ dayOnly: false, at: '2026-10-03T09:00:00Z', detail: 'Which parts go where?' });
  });

  it('lists the answer once, as the person’s, on Overview', () => {
    const answers = entries.filter((entry) => entry.kind === 'answered');
    expect(answers).toHaveLength(1);
    expect(answers[0]).toMatchObject({ who: 'you', detail: 'B — tabbed detail', subject: { href: '/dev/plan/10' } });
  });

  it('lists comments, runs on its own rows and updates', () => {
    expect(entries.find((entry) => entry.kind === 'comment')).toMatchObject({ who: 'you', detail: 'Looks right.' });
    const runs = entries.filter((entry) => entry.kind === 'run');
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({ runStatus: 'failed', detail: 'Ended without closing.' });
    expect(entries.find((entry) => entry.kind === 'update')?.update).toBe(update);
  });

  it('lists rows added in the same minute as one entry naming each', () => {
    const added = entries.filter((entry) => entry.kind === 'added');
    // The feature's own stays apart: "Added this feature".
    expect(added).toHaveLength(2);
    expect(added.find((entry) => entry.subject.number === 10)?.verb).toBe('Added');
    expect(added.find((entry) => entry.detail)).toMatchObject({
      verb: 'Added 2 steps and a question to',
      detail: '#10.1 Overview\n#10.2 Which layout?\n#10.3 Goal page',
      subject: { isFeature: true, href: '/dev/plan/10?tab=steps' },
      who: null,
    });
  });

  it('marks a row added by a session as Dash’s', () => {
    const one = featureActivity(
      feature([
        item({ id: 'f', number: 10, title: 'Feature pages' }),
        item({ id: 's', number: 11, parentId: 'f', title: 'Overview', comment: 'Added by session cse_1 on 2026-10-01.' }),
      ]),
    );
    expect(one.find((entry) => entry.subject.number === 11)?.who).toBe('dash');
    expect(one.find((entry) => entry.subject.number === 10)).toMatchObject({ who: null, subject: { isFeature: true } });
  });

  it('reads a stored step number in a note as the outline the page shows', () => {
    const entries = featureActivity(
      feature([
        item({ id: 'f', number: 10, title: 'Feature pages' }),
        item({ id: 'a', number: 31, parentId: 'f', title: 'Overview' }),
        item({
          id: 'b',
          number: 32,
          parentId: 'f',
          title: 'Steps tab',
          status: 'done',
          completedAt: '2026-10-02T10:00:00Z',
          comment: 'Done 2026-10-02: Built on #31.',
        }),
      ]),
    );
    const closed = entries.find((entry) => entry.kind === 'closed');
    expect(closed?.detail).toBe('Built on #10.1.');
    expect(closed?.subject.outline).toBe('10.2');
  });

  it('groups by day', () => {
    expect(activityDays(entries).map((day) => day.day)).toEqual([
      '2026-10-03',
      '2026-10-02',
      '2026-10-01',
    ]);
  });
});

describe('featureActivity with the history', () => {
  // Blocked and answered on the 12th, started again and closed on the 13th.
  const f = feature([
    item({ id: 'f', number: 20, title: 'History' }),
    item({
      id: 's',
      number: 21,
      parentId: 'f',
      title: 'Read the history',
      status: 'done',
      commitSha: 'feedface99',
      startedAt: '2026-10-13T08:00:00Z',
      completedAt: '2026-10-13T09:30:00Z',
      comment:
        'Blocked 2026-10-09: before the history.\n\nBlocked 2026-10-12: which table?\n\nAnswered 2026-10-12: plan_history\n\nDone 2026-10-13: Reads it.',
    }),
  ]);
  const change = (id: string, oldStatus: string, newStatus: string, actor: 'me' | 'claude', createdAt: string) => ({
    id,
    stepId: 's',
    oldStatus,
    newStatus,
    actor,
    createdAt,
  });
  const entries = featureActivity(f, {
    history: [
      change('1', 'not_started', 'in_progress', 'claude', '2026-10-12T07:00:00Z'),
      change('2', 'in_progress', 'blocked', 'claude', '2026-10-12T07:41:00Z'),
      change('3', 'blocked', 'not_started', 'me', '2026-10-12T19:05:00Z'),
      change('4', 'not_started', 'in_progress', 'claude', '2026-10-13T08:00:00Z'),
      change('5', 'in_progress', 'done', 'claude', '2026-10-13T09:30:00Z'),
      // A row whose status did not change is not a status change.
      change('6', 'done', 'done', 'claude', '2026-10-13T10:00:00Z'),
    ],
  });
  const on = (kind: string) => entries.filter((entry) => entry.kind === kind && entry.subject.number === 21);

  it('times each change since the history began, with who made it', () => {
    expect(on('blocked').map((entry) => [entry.at, entry.dayOnly, entry.who, entry.detail])).toEqual([
      ['2026-10-12T07:41:00Z', false, 'dash', 'which table?'],
      // Older than the history: still read from its line, by the day.
      ['2026-10-09T00:00:00.000Z', true, null, 'before the history.'],
    ]);
    expect(on('answered')).toMatchObject([
      { at: '2026-10-12T19:05:00Z', dayOnly: false, who: 'you', detail: 'plan_history' },
    ]);
    expect(on('started').map((entry) => entry.at)).toEqual(['2026-10-13T08:00:00Z', '2026-10-12T07:00:00Z']);
  });

  it('lists a change the columns also hold once, with the close note and commit', () => {
    expect(on('closed')).toMatchObject([
      { at: '2026-10-13T09:30:00Z', dayOnly: false, who: 'dash', detail: 'Reads it.', sha: 'feedface99' },
    ]);
    expect(entries.filter((entry) => entry.dayOnly)).toHaveLength(1);
  });
});

describe('small helpers', () => {
  it('reads the row id off a Dash action ref', () => {
    expect(stepIdFromRef('public.plan_items:abc')).toBe('abc');
    expect(stepIdFromRef('goals.items:abc')).toBeNull();
  });

  it('writes a day heading', () => {
    expect(dayHeading('2026-10-07')).toBe('7 October 2026');
  });
});
