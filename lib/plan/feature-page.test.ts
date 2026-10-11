import { describe, expect, it } from 'vitest';
import type { PlanItem } from '@/lib/plan/load';
import { buildPlanTree } from '@/lib/plan/tree';
import {
  crumbTitle,
  featureCrumbs,
  featureStatus,
  findFeature,
  newFeatureHref,
  stepGroups,
  waitedOnHref,
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

  it('reads Dev, Plan, the module, then the short title, never repeating a crumb', () => {
    const found = findFeature(tree, 10)!;
    // A Dev feature leaves the module out: Dev › Plan › Dev would say it twice.
    const dev = featureCrumbs(found.feature, found.module, 'Dev');
    expect(dev.map((crumb) => crumb.label)).toEqual(['Dev', 'Plan', 'Feature pages']);
    expect(dev[2].href).toBe('/dev/plan/10');
    const crumbs = featureCrumbs(found.feature, 'shopping', 'Shopping');
    expect(crumbs.map((crumb) => crumb.label)).toEqual(['Dev', 'Plan', 'Shopping', 'Feature pages']);
    expect(crumbs[2].href).toBe('/dev/plan#plan-module-shopping');
    // A project has a page of its own in Dev, so its crumb goes there.
    const site = findFeature(tree, 20)!;
    expect(featureCrumbs(site.feature, site.module, site.moduleLabel)[2].href).toBe(
      '/dev/projects/website',
    );
  });

  it('cuts a long title at a word for the last crumb', () => {
    expect(crumbTitle('Tidy the header')).toBe('Tidy the header');
    expect(crumbTitle("Make a feature's status, health and next agree")).toBe(
      "Make a feature's status, health…",
    );
    expect(crumbTitle('a'.repeat(40))).toBe(`${'a'.repeat(32)}…`);
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
      'done',
      'dropped',
    ]);
    expect(numbers('blocked')).toEqual([103]);
    // A step waiting on another is listed straight beneath it, in its group.
    expect(numbers('in_progress')).toEqual([104, 107]);
    // A substep with nothing ahead of it is ready, though its step is done.
    expect(numbers('ready')).toEqual([102]);
    expect(numbers('not_started')).toEqual([]);
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

  it('names the step a waiting step is listed beneath, and links to its row', () => {
    const all = groups.flatMap((group) => group.steps);
    const waiting = all.find((step) => step.node.number === 107)!;
    expect(waiting.after).toMatchObject({ number: 104, title: 'Claimed' });
    expect(all.find((step) => step.node.number === 104)?.after).toBeNull();
    expect(waitedOnHref(waiting.node, waiting.node.waitingOn[0])).toBe('#plan-104');
    expect(waitedOnHref({ outline: '100.4' }, { number: 900, outline: '899.1' })).toBe(
      '/dev/plan/900',
    );
  });

  it('keeps a step in its own group when what it waits on is closed, elsewhere or a loop', () => {
    const tree = buildPlanTree({
      items: [
        item({ id: 'f', title: 'Feature', number: 300 }),
        item({ id: 'x', title: 'Done first', parentId: 'f', number: 301, status: 'done' }),
        item({ id: 'y', title: 'After a done one', parentId: 'f', number: 302 }),
        item({ id: 'l1', title: 'Loop one', parentId: 'f', number: 303 }),
        item({ id: 'l2', title: 'Loop two', parentId: 'f', number: 304 }),
        item({ id: 'o', title: 'Other feature', number: 400 }),
        item({ id: 'z', title: 'Elsewhere', parentId: 'o', number: 401 }),
        item({ id: 'w', title: 'After elsewhere', parentId: 'f', number: 305 }),
      ],
      dependencies: [
        { id: 'y->x', itemId: 'y', dependsOnId: 'x' },
        { id: 'l1->l2', itemId: 'l1', dependsOnId: 'l2' },
        { id: 'l2->l1', itemId: 'l2', dependsOnId: 'l1' },
        { id: 'w->z', itemId: 'w', dependsOnId: 'z' },
      ],
    });
    const listed = stepGroups(findFeature(tree, 300)!.feature).flatMap((group) => group.steps);
    expect(listed.map((step) => step.node.number).sort()).toEqual([301, 302, 303, 304, 305]);
    expect(listed.every((step) => step.after === null)).toBe(true);
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

describe('newFeatureHref', () => {
  it('opens the New feature surface on the page it was pressed from, keeping the view', () => {
    expect(newFeatureHref('/dev/plan')).toBe('/dev/plan?new=feature');
    expect(newFeatureHref('/dev/plan', 'all')).toBe('/dev/plan?view=all&new=feature');
    expect(newFeatureHref('/dev/projects/website', null)).toBe(
      '/dev/projects/website?new=feature',
    );
  });

  it('reads a feature as in progress once a step beneath it has started', () => {
    const rolled = buildPlanTree({
      items: [
        item({ id: 'f', title: 'Feature', number: 30 }),
        item({ id: 'a', title: 'Underway', parentId: 'f', number: 31, status: 'in_progress' }),
        item({ id: 'g', title: 'Idle feature', number: 40 }),
        item({ id: 'h', title: 'Idle step', parentId: 'g', number: 41 }),
      ],
      dependencies: [],
    });
    expect(featureStatus(findFeature(rolled, 30)!.feature)).toBe('in_progress');
    expect(featureStatus(findFeature(rolled, 40)!.feature)).toBe('not_started');
  });
});
