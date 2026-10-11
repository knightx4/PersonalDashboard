import { describe, expect, it } from 'vitest';
import type { PlanItem } from '@/lib/plan/load';
import { buildPlanTree } from '@/lib/plan/tree';
import { heldBy, heldFrom, heldHref, progressSplit, stepsHeldBy } from './split';

let counter = 100;
function item(over: Partial<PlanItem> & { id: string }): PlanItem {
  counter += 1;
  return {
    number: counter,
    module: 'dev',
    parentId: 'f',
    title: over.id,
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

const feature = buildPlanTree({
  items: [
    item({ id: 'f', parentId: null, status: 'in_progress' }),
    item({ id: 'a', status: 'done' }),
    item({ id: 'b', assignee: 'me' }),
    item({ id: 'c' }),
    item({ id: 'c1', parentId: 'c', status: 'in_progress' }),
    item({ id: 'q', parentId: 'c', kind: 'decision' }),
    item({ id: 's', kind: 'setup', assignee: 'me' }),
    item({ id: 'gone', status: 'dropped' }),
    item({ id: 'rootq', kind: 'decision' }),
  ],
  dependencies: [],
})
  .flatMap((section) => section.nodes)
  .find((node) => node.title === 'f')!;

describe('the progress split', () => {
  it('counts steps and substeps, with questions and setup jobs, not dropped or asked on the root', () => {
    expect(progressSplit(feature)).toEqual({ scope: 6, done: 1, open: 5, me: 3, dash: 2 });
  });

  it('gives questions and setup jobs to you, and an unassigned step to Dash', () => {
    expect(heldBy({ kind: 'decision', assignee: null })).toBe('me');
    expect(heldBy({ kind: 'setup', assignee: null })).toBe('me');
    expect(heldBy({ kind: 'build', assignee: null })).toBe('dash');
    expect(heldBy({ kind: 'build', assignee: 'me' })).toBe('me');
  });

  it('lists the steps carrying each side’s open work, a question through its step', () => {
    const titles = (who: 'me' | 'dash') => stepsHeldBy(feature, who).map((n) => n.title);
    expect(titles('me')).toEqual(['b', 'c', 's']);
    expect(titles('dash')).toEqual(['c', 'c1']);
  });

  it('reads and writes the filter in the address', () => {
    expect(heldFrom('me')).toBe('me');
    expect(heldFrom('x')).toBeNull();
    expect(heldHref('/dev/plan/9', 'dash')).toBe('/dev/plan/9?tab=steps&held=dash');
  });
});
