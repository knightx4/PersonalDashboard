import { describe, expect, it } from 'vitest';
import { attachDependencies, type DependencyRow } from './dependencies';
import { reopenedGoal, withStepStatus } from './optimistic';
import { YOURS_ASK, YOURS_WORD, goalRows, numberSteps, outlineSteps } from './plan-rows';
import { buildForest, type Step, type StepNode } from './steps';

function step(id: string, extra: Partial<Step> = {}): Step {
  return {
    id,
    parentId: 'g',
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

function rows(steps: Step[], deps: DependencyRow[] = []) {
  const forest = buildForest(['g'], steps);
  attachDependencies(forest.byGoal, forest.nodes, deps);
  const roots: StepNode[] = forest.byGoal.get('g') ?? [];
  return goalRows(roots, {
    numbers: numberSteps([roots]),
    outlines: outlineSteps([roots]),
    threads: {},
    showAside: false,
  }).rows;
}

describe('withStepStatus', () => {
  it('reads a step marked done as the page would once it reloads', () => {
    const [open] = rows([step('a')]);
    const [served] = rows([step('a', { status: 'done' })]);
    const shown = withStepStatus(open, 'done');
    expect(shown.status).toBe('done');
    expect(shown.step.status).toBe('done');
    expect(shown.health.name).toBe(served.health.name);
    expect(shown.health.word).toBe(served.health.word);
    expect(shown.need).toBeNull();
  });

  it('reads a dropped step as dropped', () => {
    const [open] = rows([step('a', { kind: 'claude' })]);
    const shown = withStepStatus(open, 'dropped');
    expect(shown.health.name).toBe('dropped');
    expect(shown.step.status).toBe('dropped');
  });

  it('reads a step of yours opened again as Your move', () => {
    const [done] = rows([step('a', { status: 'done' })]);
    const [served] = rows([step('a')]);
    const shown = withStepStatus(done, 'not_started');
    expect(shown.status).toBe('not_started');
    expect(shown.step.status).toBe('open');
    expect(shown.health.word).toBe(YOURS_WORD);
    expect(shown.health.word).toBe(served.health.word);
    expect(shown.need).toBe(YOURS_ASK);
  });

  it('reads a Dash step opened again as ready', () => {
    const [done] = rows([step('a', { kind: 'claude', status: 'dropped' })]);
    const [served] = rows([step('a', { kind: 'claude' })]);
    expect(withStepStatus(done, 'not_started').health.name).toBe(served.health.name);
  });

  it('reads a step opened again with an open step before it as waiting', () => {
    const deps = [{ id: 'd', itemId: 'b', dependsOnId: 'a' }];
    const [, done] = rows([step('a'), step('b', { status: 'done', position: 20 })], deps);
    const [, served] = rows([step('a'), step('b', { position: 20 })], deps);
    const shown = withStepStatus(done, 'not_started');
    expect(shown.health.name).toBe('waiting');
    expect(shown.health.name).toBe(served.health.name);
  });

  it('leaves the row it was given alone', () => {
    const [open] = rows([step('a')]);
    withStepStatus(open, 'done');
    expect(open.step.status).toBe('open');
  });
});

describe('reopenedGoal', () => {
  it('opens a parked goal and keeps the rest', () => {
    const goal = { id: 'g', title: 'Run a marathon', status: 'parked' as const };
    expect(reopenedGoal(goal)).toEqual({ id: 'g', title: 'Run a marathon', status: 'open' });
  });
});
