import { describe, expect, it } from 'vitest';
import {
  RESHAPE_QUIET_MS,
  goalsToReshape,
  provisionalOn,
  reshapeRunText,
  type Answer,
  type GoalRunStamp,
} from './reshape-run';
import { buildForest, type Step } from './steps';
import type { Goal } from './tree';

const NOW = Date.parse('2026-10-01T12:00:00Z');
const ago = (minutes: number) => new Date(NOW - minutes * 60_000).toISOString();

function goal(id: string, extra: Partial<Goal> = {}): Goal {
  return {
    id,
    areaId: 'area',
    title: `Goal ${id}`,
    acceptance: null,
    fog: null,
    status: 'open',
    position: 10,
    unit: null,
    target: null,
    ...extra,
  };
}

function step(id: string, parentId: string, extra: Partial<Step> = {}): Step {
  return {
    id,
    parentId,
    kind: 'claude',
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

const QUESTION = step('q', 'phase', {
  kind: 'decision',
  status: 'done',
  title: 'Avalanche or snowball?',
  resolution: 'A — Avalanche.',
});
const PHASE = step('phase', 'debt', { kind: 'mine', title: 'Choose the payoff order' });
const SCHEDULE = step('schedule', 'debt', {
  status: 'proposed',
  title: 'Build the month-by-month schedule',
  detail: 'Provisional: depends on "Avalanche or snowball?".\nHighest rate first.',
});

function due(input: { goals?: Goal[]; steps?: Step[]; answers: Answer[]; runs?: GoalRunStamp[] }) {
  const goals = input.goals ?? [goal('debt', { title: 'Pay off student debt' })];
  const { byGoal } = buildForest(
    goals.map((g) => g.id),
    input.steps ?? [PHASE, QUESTION, SCHEDULE],
  );
  return goalsToReshape({ goals, stepsByGoal: byGoal, answers: input.answers, runs: input.runs ?? [], now: NOW });
}

describe('provisionalOn', () => {
  it('reads the question a provisional step names', () => {
    expect(provisionalOn(SCHEDULE.detail)).toBe('Avalanche or snowball?');
    expect(provisionalOn('Pay the card')).toBeNull();
    expect(provisionalOn(null)).toBeNull();
  });
});

describe('goalsToReshape', () => {
  it('fires for a goal once its answer is ten minutes old, with the steps it held up', () => {
    const [only, ...rest] = due({ answers: [{ questionId: 'q', answeredAt: ago(11) }] });
    expect(rest).toEqual([]);
    expect(only).toMatchObject({
      goalId: 'debt',
      questions: [{ id: 'q', title: 'Avalanche or snowball?', resolution: 'A — Avalanche.' }],
      provisional: [{ id: 'schedule', title: 'Build the month-by-month schedule', status: 'proposed' }],
    });
  });

  it('waits while answers are still coming, so answers given together start one run', () => {
    const second = step('q2', 'phase', {
      kind: 'decision',
      status: 'done',
      title: 'Refinance the private loan?',
      resolution: 'B — No.',
    });
    const steps = [PHASE, QUESTION, second, SCHEDULE];
    const answers = [
      { questionId: 'q', answeredAt: ago(14) },
      { questionId: 'q2', answeredAt: ago(RESHAPE_QUIET_MS / 60_000 - 1) },
    ];
    expect(due({ steps, answers })).toEqual([]);

    const later = [answers[0], { questionId: 'q2', answeredAt: ago(10) }];
    const fired = due({ steps, answers: later });
    expect(fired).toHaveLength(1);
    expect(fired[0].questions.map((q) => q.id)).toEqual(['q', 'q2']);
  });

  it('does not fire again for answers a later run on the goal already saw', () => {
    const answers = [{ questionId: 'q', answeredAt: ago(30) }];
    expect(due({ answers, runs: [{ itemId: 'debt', status: 'done', createdAt: ago(20) }] })).toEqual([]);
    expect(due({ answers, runs: [{ itemId: 'debt', status: 'done', createdAt: ago(40) }] })).toHaveLength(1);
  });

  it('holds off while a run on the goal is still going, and picks it up after', () => {
    const answers = [{ questionId: 'q', answeredAt: ago(30) }];
    expect(due({ answers, runs: [{ itemId: 'debt', status: 'started', createdAt: ago(35) }] })).toEqual([]);
    expect(due({ answers, runs: [{ itemId: 'debt', status: 'done', createdAt: ago(35) }] })).toHaveLength(1);
  });

  it('ignores answers to steps that are not live questions, and closed goals', () => {
    expect(due({ answers: [{ questionId: 'schedule', answeredAt: ago(30) }] })).toEqual([]);
    expect(
      due({
        goals: [goal('debt', { status: 'done' })],
        answers: [{ questionId: 'q', answeredAt: ago(30) }],
      }),
    ).toEqual([]);
  });
});

describe('reshapeRunText', () => {
  it('names the goal, the answers, the provisional steps and the run', () => {
    const [goalDue] = due({ answers: [{ questionId: 'q', answeredAt: ago(11) }] });
    const text = reshapeRunText({ userId: 'user-1', runId: 'run-1', goal: goalDue });
    expect(text).toContain('Re-shape one goal after answers: "Pay off student debt" (goals.items id debt)');
    expect(text).toContain('- "Avalanche or snowball?" (goals.items id q), answered: A — Avalanche.');
    expect(text).toContain('- "Build the month-by-month schedule" (goals.items id schedule), proposed');
    expect(text).toContain('"The re-shape run"');
    expect(text).toContain('goals.runs id run-1');
  });
});
