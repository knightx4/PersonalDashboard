import { describe, expect, it } from 'vitest';
import { HEALTH } from '@/lib/plan/health-words';
import { attachDependencies, type DependencyRow } from './dependencies';
import {
  REVIEW_ASK,
  countGoalView,
  goalCatalog,
  goalRows,
  numberSteps,
  viewGoalRows,
  type GoalRowNode,
} from './plan-rows';
import { buildForest, type Step, type StepNode } from './steps';

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

function tree(steps: Step[], deps: DependencyRow[] = []): StepNode[] {
  const forest = buildForest(['g'], steps);
  attachDependencies(forest.byGoal, forest.nodes, deps);
  return forest.byGoal.get('g') ?? [];
}

function rowsOf(roots: StepNode[], showAside = false) {
  return goalRows(roots, { numbers: numberSteps([roots]), threads: {}, showAside });
}

function find(rows: readonly GoalRowNode[], id: string): GoalRowNode {
  for (const row of rows) {
    if (row.id === id) return row;
    const below = row.children.length ? find(row.children, id) : undefined;
    if (below) return below;
  }
  return undefined as unknown as GoalRowNode;
}

const dep = (id: string, itemId: string, dependsOnId: string): DependencyRow => ({
  id,
  itemId,
  dependsOnId,
});

describe('goalRows', () => {
  it('reads a step blocked on you as the plan does, with its ask as the tooltip and Needs line', () => {
    const { rows } = rowsOf(
      tree([step('a', 'g', { status: 'blocked', blockKind: 'outside', blockAsk: 'The bank letter' })]),
    );
    const row = find(rows, 'a');
    expect(row.status).toBe('blocked');
    expect(row.health.name).toBe('blocked');
    expect(row.health.word).toBe(HEALTH.blocked.word);
    expect(row.health.title).toBe('The bank letter');
    expect(row.blockAsk).toBe('The bank letter');
    expect(row.move.word).toBe('Needs you');
  });

  it('reads a step waiting on an open step as Waiting, naming it by number', () => {
    const { rows } = rowsOf(
      tree([step('a', 'g', { title: 'List balances' }), step('b', 'g')], [dep('d1', 'b', 'a')]),
    );
    const row = find(rows, 'b');
    expect(row.health.name).toBe('waiting');
    expect(row.health.title).toBe('Waits on #1 List balances');
    expect(row.move.word).toBe('Held up');
    expect(row.dependsOn).toEqual([
      { dependencyId: 'd1', item: { id: 'a', number: 1, title: 'List balances', status: 'not_started' } },
    ]);
    expect(find(rows, 'a').blocks).toEqual([{ id: 'b', number: 2, title: 'b' }]);
  });

  it('reads a step as ready once what it waits on closes, and a stale block the same way', () => {
    const { rows } = rowsOf(
      tree(
        [
          step('a', 'g', { status: 'done' }),
          step('b', 'g'),
          step('c', 'g', { status: 'blocked', blockKind: 'steps', blockAsk: 'a first' }),
        ],
        [dep('d1', 'b', 'a'), dep('d2', 'c', 'a')],
      ),
    );
    expect(find(rows, 'b').health.name).toBe('ready');
    expect(find(rows, 'c').health.name).toBe('ready');
  });

  it('puts an unread Claude result on you without changing the step status', () => {
    const { rows } = rowsOf(
      tree([step('a', 'g', { kind: 'claude', status: 'done', result: 'Drafted the letter' })]),
    );
    const row = find(rows, 'a');
    expect(row.status).toBe('done');
    expect(row.health.name).toBe('blocked');
    expect(row.health.title).toBe(REVIEW_ASK);
    expect(row.move.word).toBe('Needs you');
    expect(row.blockAsk).toBeNull();
  });

  it('gives your steps the Yours move and leaves a Claude step to the run', () => {
    const { rows } = rowsOf(tree([step('a', 'g'), step('b', 'g', { kind: 'claude' })]));
    expect(find(rows, 'a').move.word).toBe('Yours');
    expect(find(rows, 'b').move.word).toBe('');
    expect(find(rows, 'b').health.name).toBe('ready');
  });

  it('reads a question as unanswered and an answered one as answered', () => {
    const { rows } = rowsOf(
      tree([
        step('q', 'g', { kind: 'decision' }),
        step('r', 'g', { kind: 'decision', status: 'done', resolution: 'B' }),
      ]),
    );
    expect(find(rows, 'q').kind).toBe('decision');
    expect(find(rows, 'q').health.name).toBe('unanswered');
    expect(find(rows, 'r').health.name).toBe('answered');
    expect(find(rows, 'r').health.title).toBe('B');
  });

  it('numbers steps in reading order and leaves put-aside questions out until asked for', () => {
    const roots = tree([
      step('a', 'g'),
      step('a1', 'a'),
      step('q', 'a', { kind: 'decision', dismissedAt: '2026-09-20T10:00:00Z' }),
      step('b', 'g'),
    ]);
    const hidden = rowsOf(roots);
    expect(hidden.rows.map((row) => [row.id, row.outline])).toEqual([
      ['a', '1'],
      ['b', '4'],
    ]);
    expect(find(hidden.rows, 'a').children.map((row) => row.id)).toEqual(['a1']);
    expect(find(rowsOf(roots, true).rows, 'a').children.map((row) => row.id)).toEqual([
      'a1',
      'q',
    ]);
  });

  it('counts the goal as the plan counts a module', () => {
    const { tally, progress } = rowsOf(
      tree([
        step('a', 'g', { status: 'done' }),
        step('b', 'g', { status: 'blocked', blockKind: 'outside', blockAsk: 'x' }),
        step('c', 'g'),
        step('p', 'g', { status: 'proposed' }),
      ]),
    );
    expect(tally.done).toBe(1);
    expect(tally.blocked).toBe(1);
    expect(tally.ready).toBe(1);
    expect(tally.proposed).toBe(1);
    expect(progress.done).toBe(1);
    expect(progress.live).toBe(3);
  });
});

describe('goalCatalog', () => {
  it('lists every step with its number, depth and whether it is closed', () => {
    const roots = tree([step('a', 'g'), step('a1', 'a', { status: 'done' })]);
    expect(goalCatalog(roots, numberSteps([roots]))).toEqual([
      { id: 'a', number: 1, title: 'a', parentId: 'g', depth: 0, closed: false },
      { id: 'a1', number: 2, title: 'a1', parentId: 'a', depth: 1, closed: true },
    ]);
  });
});

describe('viewGoalRows', () => {
  // A stage holding one done step, one blocked on you and one of Claude's
  // that is ready; and a question at the top level.
  const roots = tree([
    step('stage', 'g'),
    step('done', 'stage', { status: 'done' }),
    step('blocked', 'stage', { status: 'blocked', blockKind: 'outside', blockAsk: 'The letter' }),
    step('claude', 'stage', { kind: 'claude' }),
    step('question', 'g', { kind: 'decision' }),
  ]);
  const { rows } = rowsOf(roots);
  const ids = (list: readonly GoalRowNode[]): string[] =>
    list.flatMap((row) => [row.id, ...ids(row.children)]);

  it('shows everything under Everything', () => {
    expect(ids(viewGoalRows(rows, 'all'))).toEqual(['stage', 'done', 'blocked', 'claude', 'question']);
  });

  it('leaves the closed steps out of Open', () => {
    expect(ids(viewGoalRows(rows, 'open'))).toEqual(['stage', 'blocked', 'claude', 'question']);
  });

  it('keeps what waits on you under On you, with the stage over it dimmed', () => {
    const shown = viewGoalRows(rows, 'you');
    expect(ids(shown)).toEqual(['stage', 'blocked', 'question']);
    expect(shown[0].matches).toBe(false);
    expect(countGoalView(rows, 'you')).toBe(2);
  });

  it("keeps Dash's ready steps under Ready", () => {
    expect(ids(viewGoalRows(rows, 'ready'))).toEqual(['stage', 'claude']);
  });
});
