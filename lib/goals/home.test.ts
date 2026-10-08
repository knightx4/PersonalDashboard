import { describe, expect, it } from 'vitest';
import {
  areaButtons,
  briefParts,
  errandAreaDefault,
  homeAreas,
  homeLists,
  homeSummary,
  nextMove,
  nextVisitDays,
  preparedExcerpt,
  splitErrands,
  type HomeGoal,
} from '@/lib/goals/home';
import type { GoalReview, Verdict } from '@/lib/goals/reviews';
import type { TodayItem, TodayKind } from '@/lib/goals/today';

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
      bands: { on_you: 0, waiting: 0, with_dash: 0, done: 0 },
      move: 'settled',
      moves: { on_you: 0, with_dash: 0, waiting: 0, settled: 0 },
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

describe('areaButtons', () => {
  it('lists every area in its own order, with its page and its open goals', () => {
    const buttons = areaButtons(
      [
        { id: 'y', name: 'Y' },
        { id: 'x', name: 'X' },
        { id: 'z', name: 'Z' },
      ],
      [line('a', 'x'), line('b', 'y'), line('c', 'x')],
    );
    expect(buttons).toEqual([
      { id: 'y', name: 'Y', href: '/goals/area/y', goals: 1 },
      { id: 'x', name: 'X', href: '/goals/area/x', goals: 2 },
      { id: 'z', name: 'Z', href: '/goals/area/z', goals: 0 },
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

function focused(id: string, areaId: string, focus: boolean): HomeGoal {
  const base = line(id, areaId);
  return { ...base, goal: { ...base.goal, focus } as HomeGoal['goal'] };
}

function onYou(id: string, goalId: string, kind: TodayKind = 'step'): TodayItem {
  return {
    kind,
    id,
    title: id,
    detail: null,
    goalId,
    goalTitle: goalId,
    action: 'Done',
    unblocks: 0,
    on: null,
  };
}

describe('homeLists', () => {
  const today = '2026-10-06';
  const goals = [
    focused('a', 'x', true),
    focused('b', 'x', false),
    errand('soon', 'x', '2026-10-08'),
    errand('far', 'x', '2026-11-30'),
  ];

  it('keeps the focus goals and questions, flags and approvals from any goal, capped', () => {
    const ranked = [
      onYou('b-step', 'b'),
      onYou('b-question', 'b', 'question'),
      onYou('a1', 'a'),
      onYou('b-flag', 'b', 'flag'),
      onYou('soon-step', 'soon'),
      onYou('b-breakdown', 'b', 'breakdown'),
      onYou('a2', 'a'),
      onYou('far-step', 'far'),
    ];
    const { doNext, rest } = homeLists(ranked, goals, today, 5);
    expect(doNext.map((item) => item.id)).toEqual([
      'b-question',
      'a1',
      'b-flag',
      'soon-step',
      'b-breakdown',
    ]);
    expect(rest.map((item) => item.id)).toEqual(['a2']);
  });

  it('lists the goals out of focus, errands first, and an errand with no row in Do next', () => {
    expect(homeLists([], goals, today, 5).otherGoals.map((l) => l.goal.id)).toEqual([
      'soon',
      'far',
      'b',
    ]);
    const listed = homeLists([onYou('soon-step', 'soon')], goals, today, 5);
    expect(listed.otherGoals.map((l) => l.goal.id)).toEqual(['far', 'b']);
  });

  it('keeps everything while no goal is a focus goal', () => {
    const plain = [line('a', 'x'), line('b', 'x')];
    const { doNext, otherGoals } = homeLists([onYou('1', 'a'), onYou('2', 'b')], plain, today, 5);
    expect(doNext).toHaveLength(2);
    expect(otherGoals).toEqual([]);
  });
});

describe('briefParts', () => {
  it('splits the note after its first paragraph', () => {
    expect(briefParts('One.\nStill one.\n\nTwo.\n\nThree.')).toEqual({
      lead: 'One.\nStill one.',
      rest: 'Two.\n\nThree.',
    });
    expect(briefParts('  Only this.  ')).toEqual({ lead: 'Only this.', rest: null });
  });
});

describe('preparedExcerpt', () => {
  it('gives the first lines as plain text', () => {
    const text = '## Script\n\n- **Say** who you are\n- [ ] Ask for the \x60fee\x60\n1. Thank them\n> Last';
    expect(preparedExcerpt(text)).toBe('Script\nSay who you are\nAsk for the fee');
  });
});
