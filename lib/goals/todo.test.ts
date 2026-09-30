import { describe, expect, it } from 'vitest';
import { attachDependencies } from './dependencies';
import { buildForest, markStartDates, type Step } from './steps';
import { dailyView } from './daily';
import { canShowOnTodo, goalsForTodo, goalTodoSteps, todoSteps, unreadDashResults } from './todo';
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
    result: null,
    resultUrl: null,
    reviewedAt: null,
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
      { id: 'flagged', title: 'flagged', dueOn: '2026-10-01', startsOn: null, goalId: 'g', goalTitle: 'Goal g' },
      { id: 'deep', title: 'deep', dueOn: null, startsOn: null, goalId: 'g', goalTitle: 'Goal g' },
    ]);
  });

  it('keeps a step for later, with the day it starts, which a step under it shares', () => {
    const { byGoal } = buildForest(
      ['g'],
      [
        step('autopay', 'g', { onTodo: true, startsOn: '2026-11-01' }),
        step('each', 'autopay', { onTodo: true }),
        step('begun', 'g', { onTodo: true, startsOn: '2026-09-01' }),
      ],
    );
    markStartDates(byGoal, '2026-09-26');
    expect(todoSteps([goal('g')], byGoal).map((s) => [s.id, s.startsOn])).toEqual([
      ['autopay', '2026-11-01'],
      ['each', '2026-11-01'],
      ['begun', null],
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

describe('goalTodoSteps', () => {
  const today = '2026-09-29';

  function pick(goals: Goal[], steps: Step[]) {
    const { byGoal } = buildForest(
      goals.map((g) => g.id),
      steps,
    );
    markStartDates(byGoal, today);
    return goalTodoSteps(
      goals.map((g) => ({ goal: g, areaName: 'Area' })),
      byGoal,
      today,
    );
  }

  it("puts each open goal's next step of yours on Todo with nothing pressed, one per goal", () => {
    const out = pick(
      [goal('a'), goal('b')],
      [
        step('a1', 'a'),
        step('a2', 'a'),
        step('b1', 'b', { dueOn: '2026-10-20' }),
        step('b2', 'b', { dueOn: '2026-10-05' }),
      ],
    );
    expect(out).toEqual([
      { id: 'a1', title: 'a1', dueOn: null, startsOn: null, goalId: 'a', goalTitle: 'Goal a', next: true },
      { id: 'b2', title: 'b2', dueOn: '2026-10-05', startsOn: null, goalId: 'b', goalTitle: 'Goal b', next: true },
    ]);
  });

  it('keeps an overdue next step at its own due date, which the Goals home blanks', () => {
    const out = pick([goal('g')], [step('late', 'g', { dueOn: '2026-09-01' })]);
    expect(out.map((s) => [s.id, s.dueOn])).toEqual([['late', '2026-09-01']]);
  });

  it('puts nothing there for a parked or proposed goal', () => {
    const out = pick(
      [goal('parked', { status: 'parked' }), goal('proposed', { status: 'proposed' })],
      [step('p1', 'parked'), step('q1', 'proposed')],
    );
    expect(out).toEqual([]);
  });

  it('skips a step for later and a step with open steps under it, taking the next one', () => {
    const out = pick(
      [goal('g')],
      [
        step('later', 'g', { startsOn: '2026-11-01' }),
        step('parent', 'g'),
        step('child', 'parent'),
      ],
    );
    expect(out.map((s) => s.id)).toEqual(['child']);
  });

  it('puts nothing there for a step that waits on another, which Todo shows instead', () => {
    const goals = [goal('g'), goal('h')];
    const { byGoal, nodes } = buildForest(
      goals.map((g) => g.id),
      [step('waits', 'g'), step('first', 'h')],
    );
    attachDependencies(byGoal, nodes, [{ id: 'd', itemId: 'waits', dependsOnId: 'first' }]);
    const out = goalTodoSteps(
      goals.map((g) => ({ goal: g, areaName: 'Area' })),
      byGoal,
      today,
    );
    expect(out.map((s) => s.id)).toEqual(['first']);
  });

  it("puts nothing there when the only steps are Claude's, a question or a rhythm", () => {
    const out = pick(
      [goal('g')],
      [
        step('claude', 'g', { kind: 'claude' }),
        step('question', 'g', { kind: 'decision' }),
        step('rhythm', 'g', { kind: 'rhythm', rhythmCount: 2, rhythmPeriod: 'week' }),
      ],
    );
    expect(out).toEqual([]);
  });

  it('lists a flagged step that is also the next step once, and keeps other flagged steps', () => {
    const out = pick(
      [goal('g')],
      [step('first', 'g', { onTodo: true }), step('second', 'g', { onTodo: true })],
    );
    expect(out.map((s) => [s.id, s.next ?? false])).toEqual([
      ['first', true],
      ['second', false],
    ]);
  });
});

describe('goalsForTodo questions', () => {
  const today = '2026-09-29';

  function questions(goals: Goal[], steps: Step[]) {
    const { byGoal } = buildForest(
      goals.map((g) => g.id),
      steps,
    );
    markStartDates(byGoal, today);
    return goalsForTodo(
      goals.map((g) => ({ goal: g, areaName: 'Area' })),
      byGoal,
      today,
    ).questions;
  }

  it('lists each open question on an open goal with its detail and goal', () => {
    const detail = 'A — Ship it. Fast.\nB — Wait. Safer.\nRecommend A.';
    const out = questions(
      [goal('g')],
      [step('parent', 'g'), step('q', 'parent', { kind: 'decision', title: 'Which?', detail })],
    );
    expect(out).toEqual([{ id: 'q', title: 'Which?', detail, goalId: 'g', goalTitle: 'Goal g' }]);
  });

  it('leaves out an answered question, one put aside, one for later and one on a goal not open', () => {
    const out = questions(
      [goal('g'), goal('parked', { status: 'parked' })],
      [
        step('answered', 'g', { kind: 'decision', resolution: 'A', status: 'done' }),
        step('aside', 'g', { kind: 'decision', dismissedAt: '2026-09-20T00:00:00Z' }),
        step('later', 'g', { startsOn: '2026-11-01' }),
        step('under-later', 'later', { kind: 'decision' }),
        step('parked-q', 'parked', { kind: 'decision' }),
        step('open', 'g', { kind: 'decision' }),
      ],
    );
    expect(out.map((q) => q.id)).toEqual(['open']);
  });

  it('still picks the next step from the same pass', () => {
    const out = goalsForTodo(
      [{ goal: goal('g'), areaName: 'Area' }],
      buildForest(['g'], [step('q', 'g', { kind: 'decision' }), step('mine', 'g')]).byGoal,
      today,
    );
    expect(out.steps.map((s) => s.id)).toEqual(['mine']);
    expect(out.questions.map((q) => q.id)).toEqual(['q']);
  });
});

describe('unreadDashResults', () => {
  const today = '2026-09-29';

  function count(goals: Goal[], steps: Step[]) {
    const { byGoal } = buildForest(
      goals.map((g) => g.id),
      steps,
    );
    return unreadDashResults(
      dailyView(
        goals.map((g) => ({ goal: g, areaName: 'Area' })),
        byGoal,
        today,
      ),
    );
  }

  it("counts Dash's results not yet read, and nothing read, empty or dropped", () => {
    expect(
      count(
        [goal('g')],
        [
          step('a', 'g', { kind: 'claude', status: 'done', result: 'Found three.' }),
          step('b', 'g', { kind: 'claude', status: 'done', resultUrl: 'https://example.com' }),
          step('read', 'g', { kind: 'claude', status: 'done', result: 'x', reviewedAt: '2026-09-28T00:00:00Z' }),
          step('empty', 'g', { kind: 'claude' }),
          step('dropped', 'g', { kind: 'claude', status: 'dropped', result: 'x' }),
        ],
      ),
    ).toBe(2);
  });

  it('is zero with nothing waiting, and on a goal that is not open', () => {
    expect(count([goal('g')], [step('mine', 'g')])).toBe(0);
    expect(
      count([goal('p', { status: 'parked' })], [step('a', 'p', { kind: 'claude', status: 'done', result: 'x' })]),
    ).toBe(0);
  });
});
