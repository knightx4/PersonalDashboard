import { describe, expect, it } from 'vitest';
import type { PlanDependency, PlanItem } from '@/lib/plan/load';
import { buildPlanTree } from '@/lib/plan/tree';
import { scopeStatuses } from '@/lib/plan/scope-status';
import { MODULES } from '@/lib/modules';
import { PROJECT_FIXTURES } from '@/lib/plan/project-fixtures';

let counter = 0;

function item(over: Partial<PlanItem> & { id: string }): PlanItem {
  counter += 1;
  return {
    number: counter,
    module: 'shopping',
    parentId: null,
    title: `Step ${over.id}`,
    detail: null,
    acceptance: null,
    status: 'not_started',
    kind: 'build',
    track: 'feature',
    resolution: null,
    dismissedAt: null,
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
    createdAt: `2026-01-01T00:00:${String(counter).padStart(2, '0')}Z`,
    updatedAt: `2026-01-01T00:00:${String(counter).padStart(2, '0')}Z`,
    ...over,
  };
}

const dep = (itemId: string, dependsOnId: string): PlanDependency => ({
  id: `${itemId}->${dependsOnId}`,
  itemId,
  dependsOnId,
});

function statuses(items: PlanItem[], dependencies: PlanDependency[] = []) {
  return scopeStatuses(buildPlanTree({ items, dependencies, projects: PROJECT_FIXTURES }));
}

function of(result: ReturnType<typeof statuses>, scope: string) {
  const row = result.scopes.find((s) => s.scope === scope);
  if (!row) throw new Error(`no row for ${scope}`);
  return { state: row.state, count: row.count };
}

describe('scopeStatuses', () => {
  it('has a row for every workspace and active project, and none for the app as a whole', () => {
    const result = statuses([item({ id: 'f', module: null })]);
    expect(result.scopes.map((s) => s.scope)).toEqual([
      ...MODULES.map((m) => m.id),
      ...PROJECT_FIXTURES.filter((p) => !p.archivedAt).map((p) => p.id),
    ]);
    expect(result.everything).toEqual({ state: 'ready', count: 1 });
  });

  it('counts a ready step', () => {
    const result = statuses([item({ id: 'f' }), item({ id: 'a', parentId: 'f' })]);
    expect(of(result, 'shopping')).toEqual({ state: 'ready', count: 1 });
  });

  it('counts a step waiting on a ready step, and one behind that', () => {
    const result = statuses(
      [
        item({ id: 'f' }),
        item({ id: 'a', parentId: 'f' }),
        item({ id: 'b', parentId: 'f' }),
        item({ id: 'c', parentId: 'f' }),
      ],
      [dep('b', 'a'), dep('c', 'b')],
    );
    expect(of(result, 'shopping')).toEqual({ state: 'ready', count: 3 });
  });

  it('counts a step waiting on one being worked', () => {
    const result = statuses(
      [
        item({ id: 'f' }),
        item({ id: 'a', parentId: 'f', status: 'in_progress' }),
        item({ id: 'b', parentId: 'f' }),
      ],
      [dep('b', 'a')],
    );
    expect(of(result, 'shopping')).toEqual({ state: 'ready', count: 1 });
  });

  it('does not count a step behind an open question, and the scope waits', () => {
    const result = statuses(
      [
        item({ id: 'f' }),
        item({ id: 'q', parentId: 'f', kind: 'decision' }),
        item({ id: 'b', parentId: 'f' }),
        item({ id: 'c', parentId: 'f' }),
      ],
      [dep('b', 'q'), dep('c', 'b')],
    );
    expect(of(result, 'shopping')).toEqual({ state: 'waiting', count: 0 });
  });

  it('does not count a step behind a blocked step or a setup job', () => {
    const result = statuses(
      [
        item({ id: 'f' }),
        item({ id: 'x', parentId: 'f', status: 'blocked', blockKind: 'outside' }),
        item({ id: 's', parentId: 'f', kind: 'setup' }),
        item({ id: 'b', parentId: 'f' }),
        item({ id: 'c', parentId: 'f' }),
      ],
      [dep('b', 'x'), dep('c', 's')],
    );
    expect(of(result, 'shopping')).toEqual({ state: 'waiting', count: 0 });
  });

  it('counts a step waiting on a feature whose steps will all clear', () => {
    const result = statuses(
      [
        item({ id: 'f' }),
        item({ id: 'a', parentId: 'f' }),
        item({ id: 'g' }),
        item({ id: 'b', parentId: 'g' }),
      ],
      [dep('g', 'f')],
    );
    expect(of(result, 'shopping')).toEqual({ state: 'ready', count: 2 });
  });

  it('gives waiting for a proposed feature', () => {
    const result = statuses([
      item({ id: 'p', status: 'proposed' }),
      item({ id: 'a', parentId: 'p' }),
    ]);
    expect(of(result, 'shopping')).toEqual({ state: 'waiting', count: 0 });
  });

  it('gives waiting for a step being worked and nothing else open', () => {
    const result = statuses([item({ id: 'f' }), item({ id: 'a', parentId: 'f', status: 'in_progress' })]);
    expect(of(result, 'shopping')).toEqual({ state: 'waiting', count: 0 });
  });

  it('gives empty for a module with no steps, or only closed and dismissed ones', () => {
    const result = statuses([
      item({ id: 'f', module: 'news', status: 'done' }),
      item({ id: 'a', module: 'news', parentId: 'f', status: 'done' }),
      item({ id: 'd', module: 'news', status: 'dropped' }),
      item({ id: 'u', module: 'news', parentId: 'd' }),
      item({ id: 'q', module: 'news', kind: 'decision', dismissedAt: '2026-01-02T00:00:00Z' }),
    ]);
    expect(of(result, 'news')).toEqual({ state: 'empty', count: 0 });
    expect(of(result, 'shopping')).toEqual({ state: 'empty', count: 0 });
    expect(result.everything).toEqual({ state: 'empty', count: 0 });
  });

  it('works out a project the same way', () => {
    const result = statuses([
      item({ id: 'w', module: 'website' }),
      item({ id: 'a', module: 'website', parentId: 'w' }),
    ]);
    expect(of(result, 'website')).toEqual({ state: 'ready', count: 1 });
  });

  it('counts a step shared by two sections once in Everything', () => {
    const sections = buildPlanTree({
      items: [item({ id: 'f' }), item({ id: 'a', parentId: 'f' }), item({ id: 'b', parentId: 'f' })],
      dependencies: [],
      projects: PROJECT_FIXTURES,
    });
    const shopping = sections.find((s) => s.module === 'shopping')!;
    const news = sections.find((s) => s.module === 'news')!;
    const shared = sections.map((s) => (s === news ? { ...news, nodes: shopping.nodes } : s));
    const result = scopeStatuses(shared);
    expect(of(result, 'shopping').count).toBe(2);
    expect(of(result, 'news').count).toBe(2);
    expect(result.everything).toEqual({ state: 'ready', count: 2 });
  });

  it('takes Everything over the app-wide steps too', () => {
    const result = statuses([
      item({ id: 'f' }),
      item({ id: 'a', parentId: 'f' }),
      item({ id: 'g', module: null }),
      item({ id: 'q', module: null, parentId: 'g', kind: 'decision' }),
    ]);
    expect(result.everything).toEqual({ state: 'ready', count: 1 });
  });
});
