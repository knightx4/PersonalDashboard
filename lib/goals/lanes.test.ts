import { describe, expect, it } from 'vitest';
import { dashLane, laterLane } from './lanes';
import type { RunListing } from './runs';
import { buildForest, markStartDates, type Step } from './steps';

const TODAY = '2026-10-02';
const NOW = Date.parse('2026-10-02T12:00:00Z');

function step(id: string, parentId: string, extra: Partial<Step> = {}): Step {
  return {
    id,
    parentId,
    kind: 'mine',
    status: 'open',
    title: id,
    detail: null,
    acceptance: null,
    resolution: null,
    dueOn: null,
    position: 10,
    rhythmCount: null,
    rhythmPeriod: null,
    onTodo: false,
    result: null,
    resultUrl: null,
    reviewedAt: null,
    ...extra,
  };
}

const goals = [
  { goal: { id: 'a', title: 'Goal a', status: 'open' } },
  { goal: { id: 'b', title: 'Goal b', status: 'open' } },
  { goal: { id: 'p', title: 'Parked', status: 'parked' } },
];

function tree(steps: Step[]) {
  const { byGoal } = buildForest(['a', 'b', 'p'], steps);
  markStartDates(byGoal, TODAY);
  return byGoal;
}

function run(id: string, item: RunListing['item'], job: RunListing['job'] = 'goal'): RunListing {
  return {
    id,
    job,
    status: 'started',
    createdAt: new Date(NOW - 60_000).toISOString(),
    endedAt: null,
    summary: null,
    error: null,
    lastSeenAt: null,
    nowOn: null,
    item,
  };
}

describe('dashLane', () => {
  it('lists Dash’s open steps that can start, preparing ones first, working before queued', () => {
    const byGoal = tree([
      step('c1', 'a', { kind: 'claude' }),
      step('c2', 'b', { kind: 'claude' }),
      step('c3', 'a', { kind: 'claude', status: 'proposed' }),
      step('c4', 'a', { kind: 'claude', startsOn: '2026-11-01' }),
      step('c5', 'a', { kind: 'claude', status: 'done' }),
      step('c6', 'a', {
        kind: 'claude',
        status: 'blocked',
        blockKind: 'outside',
        blockAsk: 'Which board is yours? Tell me the neighbourhood',
      }),
      step('m1', 'a'),
      step('cp', 'p', { kind: 'claude' }),
    ]);
    const lane = dashLane({
      goals,
      byGoal,
      runs: [run('r1', { id: 'b', title: 'Goal b', level: 'goal' }), run('r2', { id: 'm1', title: 'm1', level: 'step' }, 'prepare')],
      now: NOW,
    });
    expect(lane.map((item) => [item.id, item.kind, item.working, item.needs])).toEqual([
      ['m1', 'preparing', true, null],
      ['c2', 'step', true, null],
      ['c1', 'step', false, null],
      ['c6', 'step', false, 'Which board is yours?'],
    ]);
  });
});

describe('laterLane', () => {
  it('lists the highest step in a branch whose own start date is ahead, soonest first', () => {
    const byGoal = tree([
      step('l1', 'a', { startsOn: '2026-11-01', dueOn: '2026-11-20' }),
      step('l1x', 'l1', { startsOn: '2026-11-05' }),
      step('l2', 'b', { startsOn: '2026-10-05' }),
      step('now', 'b', { startsOn: '2026-10-02' }),
      step('gone', 'b', { startsOn: '2026-10-09', status: 'done' }),
    ]);
    expect(laterLane({ goals, byGoal, today: TODAY })).toEqual([
      { id: 'l2', title: 'l2', goalId: 'b', goalTitle: 'Goal b', startsOn: '2026-10-05', dueOn: null },
      { id: 'l1', title: 'l1', goalId: 'a', goalTitle: 'Goal a', startsOn: '2026-11-01', dueOn: '2026-11-20' },
    ]);
  });
});
