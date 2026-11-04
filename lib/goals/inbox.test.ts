import { describe, expect, it } from 'vitest';
import { goalInboxCount, goalInboxGroups } from './inbox';
import { homeLists } from './home';
import type { StepNode } from './steps';
import { finishedNotices, type TodayItem } from './today';

/**
 * The notices of steps Dash finished that you asked about (plan #2611.2):
 * which steps make one, what the row says, and where it goes.
 */

const NOW = Date.parse('2026-10-29T12:00:00Z');
const DAY = 24 * 60 * 60 * 1000;

function node(id: string, extra: Partial<StepNode> = {}): StepNode {
  return {
    id,
    parentId: 'g1',
    kind: 'claude',
    status: 'done',
    title: `Step ${id}`,
    detail: null,
    acceptance: null,
    resolution: null,
    dueOn: null,
    position: 10,
    rhythmCount: null,
    rhythmPeriod: null,
    onTodo: false,
    result: '**Globex** is the strongest fit. It is Series B.\n\n- More.',
    resultUrl: null,
    reviewedAt: null,
    notifyOnDone: true,
    noticeSeenAt: null,
    closedAt: new Date(NOW - DAY).toISOString(),
    children: [],
    ...extra,
  } as StepNode;
}

const goals = [{ goal: { id: 'g1', title: 'Find the next job' } }];
const notices = (steps: StepNode[]) => finishedNotices(goals, new Map([['g1', steps]]), NOW);

describe('finishedNotices', () => {
  it('lists a finished step you asked about with its title and the first sentence of the result', () => {
    expect(notices([node('s1')])).toEqual([
      {
        kind: 'finished',
        id: 's1',
        title: 'Step s1',
        detail: 'Globex is the strongest fit.',
        goalId: 'g1',
        goalTitle: 'Find the next job',
        action: 'Open',
        unblocks: 0,
        on: null,
      },
    ]);
  });

  it('leaves out a step not asked about, not done, already seen, or closed over 14 days ago', () => {
    const rows = notices([
      node('off', { notifyOnDone: false }),
      node('open', { status: 'open', closedAt: null }),
      node('seen', { noticeSeenAt: new Date(NOW - 1000).toISOString() }),
      node('old', { closedAt: new Date(NOW - 15 * DAY).toISOString() }),
      node('kept', { closedAt: new Date(NOW - 13 * DAY).toISOString() }),
    ]);
    expect(rows.map((r) => r.id)).toEqual(['kept']);
  });

  it('finds sub-steps, newest first, and says nothing under a step with no result', () => {
    const rows = notices([
      node('parent', {
        closedAt: new Date(NOW - 3 * DAY).toISOString(),
        children: [node('child', { result: null, closedAt: new Date(NOW - DAY).toISOString() })],
      }),
    ]);
    expect(rows.map((r) => [r.id, r.detail])).toEqual([
      ['child', null],
      ['parent', 'Globex is the strongest fit.'],
    ]);
  });
});

describe('a finished step in the Inbox', () => {
  const [notice] = notices([node('s1')]);

  it('sits under Your actions and counts in the badge', () => {
    const groups = goalInboxGroups([notice], []);
    expect(groups.find((g) => g.key === 'actions')?.items).toEqual([notice]);
    expect(goalInboxCount([notice], [])).toBe(1);
  });

  it('is gone once seen, so the badge drops', () => {
    expect(notices([node('s1', { noticeSeenAt: new Date(NOW).toISOString() })])).toEqual([]);
    expect(goalInboxCount([], [])).toBe(0);
  });

  it('stays off Do next on the home', () => {
    const dated = {
      goal: { id: 'g1', title: 'Find the next job', dueOn: '2026-12-01' },
    } as unknown as Parameters<typeof homeLists>[1][number];
    const step: TodayItem = { ...notice, kind: 'step', id: 's2', action: 'Done' };
    expect(homeLists([step, notice], [dated], 5).doNext.map((i) => i.id)).toEqual(['s2']);
  });
});
