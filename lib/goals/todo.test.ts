import { describe, expect, it } from 'vitest';
import { buildForest, type Step } from './steps';
import { canShowOnTodo, todoSteps } from './todo';
import type { Goal } from './tree';

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
    ...extra,
  };
}

function run(goals: Goal[], steps: Step[]) {
  const { byGoal } = buildForest(
    goals.map((g) => g.id),
    steps,
  );
  return todoSteps(goals, byGoal);
}

describe('todoSteps', () => {
  it('lists flagged open steps of yours with their goal and due date', () => {
    const out = run(
      [goal('g')],
      [
        step('flagged', 'g', { onTodo: true, dueOn: '2026-10-01' }),
        step('not', 'g'),
        step('deep', 'flagged', { onTodo: true }),
      ],
    );
    expect(out).toEqual([
      { id: 'flagged', title: 'flagged', dueOn: '2026-10-01', goalId: 'g', goalTitle: 'Goal g' },
      { id: 'deep', title: 'deep', dueOn: null, goalId: 'g', goalTitle: 'Goal g' },
    ]);
  });

  it('leaves out a closed step, so ticking it on Todo takes it off', () => {
    const out = run(
      [goal('g')],
      [
        step('done', 'g', { onTodo: true, status: 'done' }),
        step('dropped', 'g', { onTodo: true, status: 'dropped' }),
      ],
    );
    expect(out).toEqual([]);
  });

  it("leaves out Claude's steps and rhythms even when flagged", () => {
    const out = run(
      [goal('g')],
      [
        step('claude', 'g', { onTodo: true, kind: 'claude' }),
        step('rhythm', 'g', { onTodo: true, kind: 'rhythm', rhythmCount: 2, rhythmPeriod: 'week' }),
      ],
    );
    expect(out).toEqual([]);
  });

  it('leaves out steps under a closed branch or a goal that is not open', () => {
    const out = run(
      [goal('open'), goal('proposed', { status: 'proposed' }), goal('done', { status: 'done' })],
      [
        step('dropped', 'open', { status: 'dropped' }),
        step('under-dropped', 'dropped', { onTodo: true }),
        step('in-proposed', 'proposed', { onTodo: true }),
        step('in-done', 'done', { onTodo: true }),
      ],
    );
    expect(out).toEqual([]);
  });

  it('leaves out a step whose branch is archived, since buildForest never reaches it', () => {
    const out = run([goal('g')], [step('orphan', 'archived-parent', { onTodo: true })]);
    expect(out).toEqual([]);
  });
});

describe('canShowOnTodo', () => {
  it('is your open steps only', () => {
    expect(canShowOnTodo({ kind: 'mine', status: 'open' })).toBe(true);
    expect(canShowOnTodo({ kind: 'mine', status: 'proposed' })).toBe(false);
    expect(canShowOnTodo({ kind: 'mine', status: 'done' })).toBe(false);
    expect(canShowOnTodo({ kind: 'claude', status: 'open' })).toBe(false);
    expect(canShowOnTodo({ kind: 'decision', status: 'open' })).toBe(false);
  });
});
