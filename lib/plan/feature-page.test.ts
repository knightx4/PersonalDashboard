import { describe, expect, it } from 'vitest';
import type { PlanItem } from '@/lib/plan/load';
import { buildPlanTree } from '@/lib/plan/tree';
import { featureCrumbs, findFeature, stepRedirect } from './feature-page';

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

const tree = buildPlanTree({
  items: [
    item({ id: 'f', title: 'Feature pages', number: 10 }),
    item({ id: 's', title: 'Overview', parentId: 'f', number: 11 }),
    item({ id: 'ss', title: 'Gallery', parentId: 's', number: 12 }),
    item({ id: 'w', title: 'Writing page', module: 'website', number: 20 }),
  ],
  dependencies: [],
});

describe('the feature page', () => {
  it("finds a feature by its own number, and a step's feature by the step's", () => {
    expect(findFeature(tree, 10)?.feature.id).toBe('f');
    const deep = findFeature(tree, 12);
    expect(deep?.feature.id).toBe('f');
    expect(deep?.target.id).toBe('ss');
    expect(findFeature(tree, 99)).toBeNull();
  });

  it("sends a step's number to its feature's Steps tab at the step's row", () => {
    const own = findFeature(tree, 10)!;
    expect(stepRedirect(own.feature, own.target)).toBeNull();
    const step = findFeature(tree, 12)!;
    expect(stepRedirect(step.feature, step.target)).toBe('/dev/plan/10?tab=steps#plan-12');
  });

  it('reads Dev, Plan, the module, then the feature', () => {
    const found = findFeature(tree, 10)!;
    const crumbs = featureCrumbs(found.feature, found.module, found.moduleLabel);
    expect(crumbs.map((crumb) => crumb.label)).toEqual(['Dev', 'Plan', found.moduleLabel, '#10']);
    expect(crumbs[2].href).toBe('/dev/plan#plan-module-dev');
    expect(crumbs[3].href).toBe('/dev/plan/10');
    // A project has a page of its own in Dev, so its crumb goes there.
    const site = findFeature(tree, 20)!;
    expect(featureCrumbs(site.feature, site.module, site.moduleLabel)[2].href).toBe(
      '/dev/projects/website',
    );
  });
});
