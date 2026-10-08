import { describe, expect, it } from 'vitest';
import type { PlanItem } from '@/lib/plan/load';
import { buildPlanTree } from '@/lib/plan/tree';
import {
  featureCrumbs,
  featureStatus,
  findFeature,
  newFeatureHref,
  stepGroups,
  stepRedirect,
  stepsViewFrom,
  stepsViewHref,
} from './feature-page';

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

describe("the Steps tab's status groups", () => {
  const grouped = buildPlanTree({
    items: [
      item({ id: 'g', title: 'Feature', number: 100 }),
      item({ id: 'a', title: 'Done step', parentId: 'g', number: 101, status: 'done' }),
      item({ id: 'a1', title: 'Open substep', parentId: 'a', number: 102 }),
      item({
        id: 'b',
        title: 'Stuck',
        parentId: 'g',
        number: 103,
        status: 'blocked',
        blockKind: 'outside',
        blockAsk: 'Which?',
      }),
      item({ id: 'c', title: 'Claimed', parentId: 'g', number: 104, status: 'in_progress' }),
      item({ id: 'c1', title: 'Gone', parentId: 'c', number: 105, status: 'dropped' }),
      item({ id: 'q', title: 'Which way?', parentId: 'g', number: 106, kind: 'decision' }),
      item({ id: 'd', title: 'After the claim', parentId: 'g', number: 107 }),
    ],
    dependencies: [{ id: 'd->c', itemId: 'd', dependsOnId: 'c' }],
  });
  const feature = findFeature(grouped, 100)!.feature;
  const groups = stepGroups(feature);
  const numbers = (id: string) =>
    groups.find((group) => group.id === id)?.steps.map((step) => step.node.number) ?? [];

  it('lists every step and substep once, under its own status, and leaves questions out', () => {
    expect(groups.map((group) => group.id)).toEqual([
      'blocked',
      'in_progress',
      'ready',
      'not_started',
      'done',
      'dropped',
    ]);
    expect(numbers('blocked')).toEqual([103]);
    expect(numbers('in_progress')).toEqual([104]);
    // A substep with nothing ahead of it is ready, though its step is done.
    expect(numbers('ready')).toEqual([102]);
    // Waiting on another step has not started.
    expect(numbers('not_started')).toEqual([107]);
    expect(numbers('done')).toEqual([101]);
    expect(numbers('dropped')).toEqual([105]);
    const all = groups.flatMap((group) => group.steps.map((step) => step.node.number));
    expect(new Set(all).size).toBe(all.length);
    expect(all).not.toContain(106);
  });

  it('names the step a substep sits under, and nothing for a step', () => {
    const substep = groups.flatMap((group) => group.steps).find((step) => step.node.number === 102);
    expect(substep?.parent).toMatchObject({ number: 101, title: 'Done step' });
    expect(substep?.parent?.outline).toBe(substep?.node.outline.split('.').slice(0, -1).join('.'));
    const step = groups.flatMap((group) => group.steps).find((s) => s.node.number === 103);
    expect(step?.parent).toBeNull();
  });

  it('folds done and dropped, and leaves out an empty group', () => {
    expect(groups.filter((group) => group.folded).map((group) => group.id)).toEqual([
      'done',
      'dropped',
    ]);
    const empty = findFeature(
      buildPlanTree({ items: [item({ id: 'e', title: 'Empty', number: 200 })], dependencies: [] }),
      200,
    )!.feature;
    expect(stepGroups(empty)).toEqual([]);
  });

  it('keeps the tree one press away, in the address', () => {
    expect(stepsViewFrom(null)).toBe('status');
    expect(stepsViewFrom('tree')).toBe('tree');
    expect(stepsViewFrom('nonsense')).toBe('status');
    expect(stepsViewHref(100, 'status')).toBe('/dev/plan/100?tab=steps');
    expect(stepsViewHref(100, 'tree')).toBe('/dev/plan/100?tab=steps&view=tree');
  });
});

describe("a feature's status", () => {
  const status = (steps: Partial<PlanItem>[], own: Partial<PlanItem> = {}) => {
    const tree = buildPlanTree({
      items: [
        item({ id: 'f', title: 'Feature', number: 200, ...own }),
        ...steps.map((s, i) =>
          item({ id: `s${i}`, title: `Step ${i}`, parentId: 'f', number: 201 + i, ...s }),
        ),
      ],
      dependencies: [],
    });
    return featureStatus(findFeature(tree, 200)!.feature);
  };

  it('reads in progress once any step has started', () => {
    expect(status([{ status: 'in_progress' }])).toBe('in_progress');
  });
  it('stays not started when no step has', () => {
    expect(status([{ status: 'not_started' }])).toBe('not_started');
  });
  it('keeps a status the feature already holds', () => {
    expect(
      status([{ status: 'in_progress' }], {
        status: 'blocked',
        blockKind: 'outside',
        blockAsk: 'x',
      }),
    ).toBe('blocked');
  });
});

describe('newFeatureHref', () => {
  it('opens the New feature surface on the page it was pressed from, keeping the view', () => {
    expect(newFeatureHref('/dev/plan')).toBe('/dev/plan?new=feature');
    expect(newFeatureHref('/dev/plan', 'all')).toBe('/dev/plan?view=all&new=feature');
    expect(newFeatureHref('/dev/projects/website', null)).toBe('/dev/projects/website?new=feature');
  });
});
