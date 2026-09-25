import { describe, expect, it } from 'vitest';
import { readyClaudeSteps } from './daily-run';
import {
  attachDependencies,
  isStaleStepBlock,
  planStatusOf,
  readySteps,
  stepStatusFromPlan,
  type DependencyRow,
} from './dependencies';
import { stepHealth, stepNeeds, stepState } from './status';
import { buildForest, type Step } from './steps';
import type { Goal } from './tree';

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

const goal: Goal = {
  id: 'g',
  areaId: 'area',
  title: 'Goal',
  acceptance: null,
  fog: null,
  status: 'open',
  position: 10,
  unit: null,
  target: null,
};

function tree(steps: Step[], deps: DependencyRow[] = []) {
  const forest = buildForest(['g'], steps);
  attachDependencies(forest.byGoal, forest.nodes, deps);
  const roots = forest.byGoal.get('g') ?? [];
  return { roots, node: (id: string) => forest.nodes.get(id)!, byGoal: forest.byGoal };
}

const edge = (itemId: string, dependsOnId: string): DependencyRow => ({
  id: `${itemId}->${dependsOnId}`,
  itemId,
  dependsOnId,
});

describe('waiting on other steps', () => {
  it('reads as Waiting until the other step closes, then ready', () => {
    const open = tree([step('bank', 'g'), step('pay', 'g')], [edge('pay', 'bank')]);
    expect(open.node('pay').waitingOn?.map((ref) => ref.id)).toEqual(['bank']);
    expect(open.node('bank').blocks?.map((ref) => ref.id)).toEqual(['pay']);
    expect(stepHealth(open.node('pay'))).toBe('waiting');
    expect(stepState(open.node('pay')).word).toBe('Waiting');
    expect(stepState(open.node('pay')).title).toBe('Waits on bank.');
    expect(stepNeeds(open.node('pay'))).toBe('bank to close first.');
    expect(readySteps(open.roots).has('pay')).toBe(false);

    const closed = tree(
      [step('bank', 'g', { status: 'done' }), step('pay', 'g')],
      [edge('pay', 'bank')],
    );
    expect(closed.node('pay').waitingOn).toEqual([]);
    expect(stepHealth(closed.node('pay'))).toBe('yours');
    expect(readySteps(closed.roots).has('pay')).toBe(true);
  });

  it('holds every step beneath one that waits', () => {
    const { node, roots } = tree(
      [step('bank', 'g'), step('pay', 'g'), step('card', 'pay')],
      [edge('pay', 'bank')],
    );
    expect(node('card').waitingOn?.map((ref) => ref.id)).toEqual(['bank']);
    expect(readySteps(roots).has('card')).toBe(false);
  });

  it('keeps a waiting Claude step out of the morning run until the other closes', () => {
    const steps = [step('bank', 'g'), step('draft', 'g', { kind: 'claude' })];
    const waiting = tree(steps, [edge('draft', 'bank')]);
    expect(readyClaudeSteps([goal], waiting.byGoal)).toEqual([]);
    const free = tree([{ ...steps[0], status: 'dropped' }, steps[1]], [edge('draft', 'bank')]);
    expect(readyClaudeSteps([goal], free.byGoal).map((s) => s.id)).toEqual(['draft']);
  });

  it('leaves out an edge to a step that is not shown', () => {
    const { node } = tree([step('pay', 'g')], [edge('pay', 'archived')]);
    expect(node('pay').dependsOn).toEqual([]);
    expect(stepHealth(node('pay'))).toBe('yours');
  });
});

describe('blocked steps', () => {
  it('shows what a step blocked on you needs, and is on you', () => {
    const { node, roots } = tree([
      step('call', 'g', { status: 'blocked', blockKind: 'outside', blockAsk: 'The account number.' }),
    ]);
    expect(stepHealth(node('call'))).toBe('blocked');
    expect(stepState(node('call')).word).toBe('On you');
    expect(stepNeeds(node('call'))).toBe('The account number.');
    expect(readySteps(roots).has('call')).toBe(false);
  });

  it('reads as open again once unblocked', () => {
    const { node } = tree([step('call', 'g')]);
    expect(stepHealth(node('call'))).toBe('yours');
    expect(stepNeeds(node('call'))).toBeNull();
  });

  it('clears a block on steps once every one of them has closed', () => {
    const blocked = { status: 'blocked' as const, blockKind: 'steps' as const, blockAsk: 'The statement.' };
    const open = tree([step('bank', 'g'), step('pay', 'g', blocked)], [edge('pay', 'bank')]);
    expect(isStaleStepBlock(open.node('pay'))).toBe(false);
    expect(stepHealth(open.node('pay'))).toBe('waiting');
    expect(stepNeeds(open.node('pay'))).toBe('The statement.');

    const done = tree(
      [step('bank', 'g', { status: 'done' }), step('pay', 'g', blocked)],
      [edge('pay', 'bank')],
    );
    expect(isStaleStepBlock(done.node('pay'))).toBe(true);
    expect(stepHealth(done.node('pay'))).toBe('yours');
    expect(readySteps(done.roots).has('pay')).toBe(true);
  });

  it('holds the steps under one blocked on you, and not under one blocked on steps', () => {
    const outside = tree([
      step('pay', 'g', { status: 'blocked', blockKind: 'outside' }),
      step('card', 'pay'),
    ]);
    expect(readySteps(outside.roots).has('card')).toBe(false);
    const onSteps = tree([
      step('pay', 'g', { status: 'blocked', blockKind: 'steps' }),
      step('card', 'pay'),
    ]);
    expect(readySteps(onSteps.roots).has('card')).toBe(true);
  });

  it('holds a parent open while a sub-step is blocked', () => {
    const { node } = tree([step('pay', 'g'), step('card', 'pay', { status: 'blocked', blockKind: 'outside' })]);
    expect(stepHealth(node('pay'))).toBe('waiting');
  });
});

describe('statuses as the plan words them', () => {
  it('maps open to not started and back', () => {
    expect(planStatusOf('open')).toBe('not_started');
    expect(planStatusOf('blocked')).toBe('blocked');
    expect(planStatusOf('proposed')).toBe('proposed');
    expect(stepStatusFromPlan('not_started')).toBe('open');
    expect(stepStatusFromPlan('in_progress')).toBe('open');
    expect(stepStatusFromPlan('done')).toBe('done');
    expect(stepStatusFromPlan('proposed')).toBeNull();
  });
});
