import { describe, expect, it } from 'vitest';
import type { PlanItem } from '@/lib/plan/load';
import { applyView, buildPlanTree, PLAN_VIEW_CHIPS } from '@/lib/plan/tree';
import { featureCount, featureTable } from './feature-table';

let counter = 0;
function item(over: Partial<PlanItem> & { id: string; title: string }): PlanItem {
  counter += 1;
  return {
    number: counter,
    module: 'dev',
    parentId: null,
    detail: null,
    acceptance: null,
    status: 'not_started',
    kind: 'build',
    track: 'feature',
    fog: null,
    resolution: null,
    dismissedAt: null,
    fogDismissedAt: null,
    comment: null,
    blockAsk: null,
    blockKind: null,
    thread: [],
    priority: 2,
    size: null,
    assignee: null,
    commitSha: null,
    position: counter * 10,
    startedAt: null,
    completedAt: null,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    ...over,
  };
}

const whole = buildPlanTree({
  items: [
    item({ id: 'f', title: 'Feature pages', number: 10, status: 'in_progress', size: 'l' }),
    item({ id: 'a', title: 'Overview', parentId: 'f', status: 'done' }),
    item({ id: 'b', title: 'Steps tab', parentId: 'f', status: 'in_progress' }),
    item({ id: 'c', title: 'Table', parentId: 'f' }),
    item({ id: 'c1', title: 'Gallery', parentId: 'c', status: 'dropped' }),
    item({ id: 'c2', title: 'Wire it', parentId: 'c' }),
    item({ id: 'old', title: 'Shipped', number: 20, status: 'done' }),
    item({ id: 'old1', title: 'Its step', parentId: 'old', status: 'done' }),
    item({ id: 'reopened', title: 'Shipped then grew', status: 'done' }),
    item({ id: 'new', title: 'A question after', parentId: 'reopened', kind: 'decision' }),
    item({ id: 'aside', title: 'Put aside', dismissedAt: '2026-01-02T00:00:00Z' }),
    item({ id: 'g', title: 'Goal pages', module: 'goals', status: 'proposed' }),
    item({ id: 'done-only', title: 'All done', module: 'learn', status: 'done' }),
  ],
  dependencies: [],
});

describe('the feature table', () => {
  const groups = featureTable(applyView(whole, 'table'));

  it('lists every open feature by module, and no module with none', () => {
    expect(groups.map((g) => g.module)).toEqual(['goals', 'dev']);
    expect(groups.find((g) => g.module === 'dev')!.rows.map((r) => r.node.id)).toEqual([
      'f',
      'reopened',
    ]);
    expect(featureCount(groups)).toBe(3);
  });

  it('counts the open leaf steps and the percent done over the live ones', () => {
    const row = groups.find((g) => g.module === 'dev')!.rows[0];
    // Leaves: a (done), b (in progress), c1 (dropped), c2 (open).
    expect(row.openSteps).toBe(2);
    // Three live leaves, one done.
    expect(row.percent).toBe(33);
  });

  it("reads a closed feature's health off what is open beneath it", () => {
    const row = groups.find((g) => g.module === 'dev')!.rows[1];
    expect(row.health).toBe('unanswered');
  });

  it('says nothing about percent for a feature with no live steps', () => {
    const row = groups.find((g) => g.module === 'goals')!.rows[0];
    expect(row.percent).toBeNull();
    expect(row.health).toBe('proposed');
  });

  it('is a chip on the plan, and its view prunes nothing beneath a feature', () => {
    expect(PLAN_VIEW_CHIPS).toContain('table');
    const dev = applyView(whole, 'table').find((s) => s.module === 'dev')!;
    expect(dev.nodes.find((n) => n.id === 'f')!.children).toHaveLength(3);
  });
});
