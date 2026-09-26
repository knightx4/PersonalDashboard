import { describe, expect, it } from 'vitest';
import { homeAreas, homeSummary, nextMove, type HomeGoal } from '@/lib/goals/home';
import type { GoalReview, Verdict } from '@/lib/goals/reviews';

function review(verdict: Verdict, extra: Partial<GoalReview> = {}): GoalReview {
  return {
    id: 'r',
    goalId: 'g',
    verdict,
    reason: '',
    nextMove: 'Do the thing',
    nextOn: null,
    stepId: null,
    waitsOnId: null,
    runId: null,
    createdAt: '2026-09-26T06:00:00Z',
    ...extra,
  };
}

const status = (verdict: Verdict | null) => ({ review: verdict ? review(verdict) : null });

describe('homeSummary', () => {
  it('names what needs you first, then the rest', () => {
    expect(
      homeSummary([
        status('on_track'),
        status('waiting_on_you'),
        status('waiting_on_you'),
        status('waiting_on_date'),
        status(null),
      ]),
    ).toBe(
      '2 of your 5 goals are waiting on you, 1 is on track, 1 is waiting on a date and 1 has no status yet.',
    );
  });

  it('says all, or your one goal, when every goal agrees', () => {
    expect(homeSummary([status('on_track'), status('on_track')])).toBe(
      'All 2 of your goals are on track.',
    );
    expect(homeSummary([status('stalled')])).toBe('Your one goal has stalled.');
  });

  it('is null with no goals', () => {
    expect(homeSummary([])).toBeNull();
  });
});

function line(id: string, areaId: string, extra: Partial<HomeGoal> = {}): HomeGoal {
  return {
    goal: {
      id,
      areaId,
      title: id,
      acceptance: null,
      fog: null,
      status: 'open',
      position: 10,
      unit: null,
      target: null,
    },
    areaName: areaId.toUpperCase(),
    progress: {
      live: 0,
      done: 0,
      bands: { on_you: 0, waiting: 0, with_claude: 0, done: 0 },
      move: 'settled',
      moves: { on_you: 0, with_claude: 0, waiting: 0, settled: 0 },
      questions: 0,
    },
    review: null,
    current: false,
    next: null,
    hasSteps: true,
    ...extra,
  };
}

describe('homeAreas', () => {
  it('gathers goals under their areas in the order the areas first come', () => {
    const areas = homeAreas([line('a', 'x'), line('b', 'y'), line('c', 'x')]);
    expect(areas.map((a) => [a.areaName, a.goals.map((g) => g.goal.id)])).toEqual([
      ['X', ['a', 'c']],
      ['Y', ['b']],
    ]);
  });
});

describe('nextMove', () => {
  it('takes the status’s next move, then the first next step, then nothing', () => {
    const next = { id: 's', title: 'List the balances', kind: 'mine' as const, dueOn: '2026-10-01', under: null };
    expect(nextMove(line('a', 'x', { review: review('on_track', { nextOn: '2026-09-30' }), next }))).toEqual({
      text: 'Do the thing',
      on: '2026-09-30',
    });
    expect(nextMove(line('a', 'x', { next }))).toEqual({ text: 'List the balances', on: '2026-10-01' });
    expect(nextMove(line('a', 'x'))).toBeNull();
  });
});
