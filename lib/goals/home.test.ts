import { describe, expect, it } from 'vitest';
import {
  errandAreaDefault,
  homeAreas,
  homeSummary,
  nextMove,
  nextVisitDays,
  splitErrands,
  stuckSteps,
  weekHealth,
  type HomeGoal,
} from '@/lib/goals/home';
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

function errand(id: string, areaId: string, dueOn: string): HomeGoal {
  const base = line(id, areaId);
  return { ...base, goal: { ...base.goal, errand: true, dueOn } };
}

describe('splitErrands', () => {
  it('lists open errands soonest due first and leaves them out of the areas', () => {
    const { errands, others } = splitErrands([
      line('a', 'x'),
      errand('late', 'x', '2026-10-20'),
      errand('soon', 'y', '2026-10-09'),
      line('b', 'y'),
    ]);
    expect(errands.map((l) => l.goal.id)).toEqual(['soon', 'late']);
    expect(others.map((l) => l.goal.id)).toEqual(['a', 'b']);
  });
});

describe('errandAreaDefault', () => {
  it('takes the soonest errand’s area, then the first area', () => {
    const areas = [{ id: 'x' }, { id: 'y' }];
    expect(errandAreaDefault([errand('soon', 'y', '2026-10-09')], areas)).toBe('y');
    expect(errandAreaDefault([], areas)).toBe('x');
    expect(errandAreaDefault([errand('gone', 'z', '2026-10-09')], areas)).toBe('x');
    expect(errandAreaDefault([], [])).toBeNull();
  });
});

describe('nextMove', () => {
  it('takes the status’s next move, then the first next step, then nothing', () => {
    const next = {
      id: 's',
      title: 'List the balances',
      kind: 'mine' as const,
      dueOn: '2026-10-01',
      under: null,
    };
    expect(
      nextMove(line('a', 'x', { review: review('on_track', { nextOn: '2026-09-30' }), next })),
    ).toEqual({
      text: 'Do the thing',
      on: '2026-09-30',
    });
    expect(nextMove(line('a', 'x', { next }))).toEqual({
      text: 'List the balances',
      on: '2026-10-01',
    });
    expect(nextMove(line('a', 'x'))).toBeNull();
  });
});

describe('nextVisitDays', () => {
  it('adds today once, oldest first', () => {
    expect(nextVisitDays(['2026-09-24', '2026-09-22'], '2026-09-26')).toEqual([
      '2026-09-22',
      '2026-09-24',
      '2026-09-26',
    ]);
    expect(nextVisitDays(['2026-09-26'], '2026-09-26')).toEqual(['2026-09-26']);
  });

  it('keeps only the last 28 days', () => {
    expect(nextVisitDays(['2026-08-29', '2026-08-30', '2026-09-20'], '2026-09-26')).toEqual([
      '2026-08-30',
      '2026-09-20',
      '2026-09-26',
    ]);
  });
});

describe('stuckSteps', () => {
  const now = Date.parse('2026-09-26T12:00:00Z');
  const old = '2026-09-18T12:00:00Z';
  const recent = '2026-09-22T12:00:00Z';
  type Node =
    Parameters<typeof stuckSteps>[1] extends ReadonlyMap<string, readonly (infer N)[]> ? N : never;
  const step = (id: string, extra: Partial<Node> = {}): Node => ({
    id,
    kind: 'mine',
    status: 'open',
    children: [],
    ...extra,
  });

  it('counts open steps of yours unchanged for a week', () => {
    const goals = [{ goal: { id: 'g', status: 'open' } }];
    const byGoal = new Map([
      [
        'g',
        [
          step('old'),
          step('recent'),
          step('claude', { kind: 'claude' }),
          step('done', { status: 'done' }),
          step('waiting', { waitingOn: [{}] }),
          step('later', { waitsUntil: '2026-10-01' }),
          step('phase', { children: [step('child'), step('closed', { status: 'done' })] }),
          step('dropped', { status: 'dropped', children: [step('under-dropped')] }),
        ],
      ],
    ]);
    const updatedAt = new Map(
      [
        'old',
        'claude',
        'done',
        'waiting',
        'later',
        'phase',
        'child',
        'closed',
        'dropped',
        'under-dropped',
      ].map((id) => [id, old]),
    );
    updatedAt.set('recent', recent);
    // old, and child under the phase; the phase itself has an open step beneath it.
    expect(stuckSteps(goals, byGoal, updatedAt, now)).toBe(2);
  });

  it('leaves out goals that are not open', () => {
    const byGoal = new Map([['g', [step('old')]]]);
    const updatedAt = new Map([['old', old]]);
    expect(stuckSteps([{ goal: { id: 'g', status: 'proposed' } }], byGoal, updatedAt, now)).toBe(0);
  });
});

describe('weekHealth', () => {
  const week = {
    startsOn: '2026-09-21',
    endsOn: '2026-09-28',
    from: '2026-09-21T04:00:00.000Z',
    to: '2026-09-28T04:00:00.000Z',
  };

  it('counts only what falls in the week', () => {
    expect(
      weekHealth({
        week,
        dashClosedAt: [
          '2026-09-21T03:59:59Z',
          '2026-09-21T04:00:00Z',
          '2026-09-26T10:00:00Z',
          '2026-09-28T04:00:00Z',
        ],
        waitingOnYou: 7,
        stuck: 2,
        visitDays: ['2026-09-19', '2026-09-21', '2026-09-24', '2026-09-26', '2026-09-28'],
      }),
    ).toEqual({ dashFinished: 2, waitingOnYou: 7, stuck: 2, daysVisited: 3 });
  });
});
