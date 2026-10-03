import { describe, expect, it } from 'vitest';
import { dashOffers, goalHolders, preparableSteps, QUIET_DAYS } from './hand-off';
import type { HomeGoal } from './home';
import type { RunListing } from './runs';
import type { GoalProgress } from './status';
import { buildForest, type Step } from './steps';
import type { TodayItem } from './today';

const NOW = Date.parse('2026-10-02T12:00:00Z');
const DAY = 86_400_000;

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

const progress: GoalProgress = {
  live: 4,
  done: 1,
  bands: { on_you: 2, waiting: 0, with_dash: 1, done: 1 },
  move: 'on_you',
  moves: { on_you: 2, with_dash: 1, waiting: 0, settled: 0 },
  questions: 0,
};

function line(id: string, extra: Partial<HomeGoal> = {}): HomeGoal {
  return {
    goal: {
      id,
      areaId: 'area',
      title: `Goal ${id}`,
      acceptance: null,
      fog: null,
      status: 'open',
      position: 10,
      unit: null,
      target: null,
    },
    areaName: 'Area',
    progress,
    review: null,
    current: false,
    next: null,
    hasSteps: true,
    ...extra,
  };
}

function run(id: string, item: RunListing['item'], extra: Partial<RunListing> = {}): RunListing {
  return {
    id,
    job: 'goal',
    status: 'done',
    createdAt: new Date(NOW - DAY).toISOString(),
    endedAt: null,
    summary: null,
    error: null,
    lastSeenAt: null,
    nowOn: null,
    item,
    ...extra,
  };
}

function onYou(id: string, goalId: string, extra: Partial<TodayItem> = {}): TodayItem {
  return {
    kind: 'step',
    id,
    title: id,
    detail: null,
    goalId,
    goalTitle: `Goal ${goalId}`,
    action: 'Done',
    unblocks: 0,
    on: null,
    ...extra,
  };
}

const { byGoal } = buildForest(
  ['a', 'b', 'c'],
  [
    step('a1', 'a'),
    step('a2', 'a', { result: 'A draft is on it already' }),
    step('a3', 'a'),
    step('a4', 'a', { kind: 'claude' }),
    step('b1', 'b'),
    step('b1x', 'b1'),
    step('c1', 'c', { kind: 'claude', status: 'done' }),
  ],
);

describe('goalHolders', () => {
  it('counts what is on you, Dash’s open steps, and the run going on a goal or its steps', () => {
    const going = run('r1', { id: 'a1', title: 'a1', level: 'step' }, {
      status: 'started',
      createdAt: new Date(NOW - 5 * 60_000).toISOString(),
    });
    const holders = goalHolders({
      goals: [line('a'), line('b'), line('c')],
      byGoal,
      onYou: [onYou('a1', 'a'), onYou('a3', 'a'), onYou('b1x', 'b')],
      runs: [going, run('r2', { id: 'b', title: 'Goal b', level: 'goal' })],
      now: NOW,
    });
    expect(holders.get('a')).toMatchObject({ onYou: 2, dashOpen: 1, working: going });
    expect(holders.get('b')).toMatchObject({ onYou: 1, dashOpen: 0, working: null });
    expect(holders.get('b')!.lastDashAt).toBe(new Date(NOW - DAY).toISOString());
    expect(holders.get('c')).toMatchObject({ onYou: 0, dashOpen: 0, working: null, lastDashAt: null });
  });

  it('does not take a run gone quiet for one still going', () => {
    const quiet = run('r1', { id: 'a', title: 'Goal a', level: 'goal' }, {
      status: 'started',
      createdAt: new Date(NOW - 2 * 60 * 60_000).toISOString(),
    });
    const holders = goalHolders({ goals: [line('a')], byGoal, onYou: [], runs: [quiet], now: NOW });
    expect(holders.get('a')!.working).toBeNull();
  });
});

describe('preparableSteps', () => {
  it('keeps steps of yours with nothing prepared, no sub-steps and no prepare going', () => {
    const preparing = run('p', { id: 'a3', title: 'a3', level: 'step' }, {
      job: 'prepare',
      status: 'started',
      createdAt: new Date(NOW - 60_000).toISOString(),
    });
    const ids = preparableSteps({
      byGoal,
      onYou: [
        onYou('a1', 'a'),
        onYou('a2', 'a'),
        onYou('a3', 'a'),
        onYou('b1', 'b'),
        onYou('b1x', 'b'),
        onYou('a1', 'a', { kind: 'question' }),
      ],
      runs: [preparing],
      now: NOW,
    });
    expect(ids).toEqual(['a1', 'b1x']);
  });
});

describe('dashOffers', () => {
  it('offers the first steps to prepare, then goals Dash has left alone, stalled first', () => {
    const goals = [
      line('a'),
      line('b'),
      line('c', {
        review: {
          id: 'r',
          goalId: 'c',
          verdict: 'stalled',
          reason: '',
          nextMove: '',
          nextOn: null,
          stepId: null,
          waitsOnId: null,
          runId: null,
          createdAt: new Date(NOW).toISOString(),
        },
      }),
    ];
    const runs = [run('old', { id: 'b', title: 'Goal b', level: 'goal' }, {
      createdAt: new Date(NOW - (QUIET_DAYS + 3) * DAY).toISOString(),
    })];
    const items = [onYou('a1', 'a'), onYou('a3', 'a'), onYou('b1x', 'b')];
    const holders = goalHolders({ goals, byGoal, onYou: items, runs, now: NOW });
    const offers = dashOffers({ goals, byGoal, onYou: items, holders, runs, now: NOW });
    expect(offers).toEqual([
      { kind: 'prepare', stepId: 'a1', title: 'a1', goalId: 'a', goalTitle: 'Goal a' },
      { kind: 'prepare', stepId: 'a3', title: 'a3', goalId: 'a', goalTitle: 'Goal a' },
      { kind: 'goal', goalId: 'c', title: 'Goal c', reason: 'Stalled. Dash has not worked on it yet.' },
      {
        kind: 'goal',
        goalId: 'b',
        title: 'Goal b',
        reason: `Dash has not worked on it in ${QUIET_DAYS + 3} days.`,
      },
    ]);
  });

  it('leaves out a goal Dash worked on this week or has open steps in', () => {
    const goals = [line('a'), line('b')];
    const runs = [run('recent', { id: 'b1', title: 'b1', level: 'step' })];
    const holders = goalHolders({ goals, byGoal, onYou: [], runs, now: NOW });
    const offers = dashOffers({ goals, byGoal, onYou: [], holders, runs, now: NOW });
    expect(offers).toEqual([]);
  });
});
