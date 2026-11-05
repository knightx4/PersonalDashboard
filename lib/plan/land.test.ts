import { describe, expect, it } from 'vitest';
import type { PlanItem } from './load';
import {
  builtSteps,
  featuresToLand,
  isBuilt,
  LAND_AT_BUILT,
  LAND_RETRY_AFTER_MINUTES,
  landNowLine,
  landTurn,
} from './land';
import { buildPlanTree, findNode } from './tree';

const NOW = Date.parse('2026-11-04T23:00:00.000Z');
const BUILT = 'Claimed.\n\nBuilt 2026-11-04 on plan/1 (abc1234): the export.';

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
    createdAt: '2026-11-01T00:00:00Z',
    updatedAt: '2026-11-01T00:00:00Z',
    ...over,
  };
}

const built = (id: string, parentId: string, over: Partial<PlanItem> = {}) =>
  item({ id, parentId, status: 'in_progress', comment: BUILT, commitSha: 'abc1234', ...over });

describe('isBuilt', () => {
  it('is a step in progress whose last paragraph is its Built line', () => {
    expect(isBuilt({ status: 'in_progress', comment: BUILT })).toBe(true);
  });

  it('is not a live claim, a closed step, or a Built line followed by more', () => {
    expect(isBuilt({ status: 'in_progress', comment: 'Claimed by a session.' })).toBe(false);
    expect(isBuilt({ status: 'done', comment: BUILT })).toBe(false);
    expect(isBuilt({ status: 'in_progress', comment: `${BUILT}\n\nReopened: the merge failed.` })).toBe(
      false,
    );
  });
});

describe('builtSteps', () => {
  it('finds built steps at any depth beneath the feature, in plan order', () => {
    const sections = buildPlanTree({
      items: [
        item({ id: 'f' }),
        built('a', 'f'),
        item({ id: 'b', parentId: 'f' }),
        item({ id: 'c', parentId: 'f' }),
        built('c1', 'c'),
      ],
      dependencies: [],
    });
    expect(builtSteps(findNode(sections, 'f')!).map((step) => step.id)).toEqual(['a', 'c1']);
  });
});

describe('featuresToLand', () => {
  const plan = () =>
    buildPlanTree({
      items: [
        item({ id: 'one' }),
        built('one-a', 'one'),
        item({ id: 'one-b', parentId: 'one' }),
        item({ id: 'two' }),
        built('two-a', 'two'),
        built('two-b', 'two'),
        item({ id: 'none' }),
        item({ id: 'none-a', parentId: 'none' }),
        item({ id: 'idea', status: 'proposed' }),
        built('idea-a', 'idea'),
      ],
      dependencies: [],
    });

  it('names every open approved feature with a built step, most built first', () => {
    const out = featuresToLand(plan(), { runningIds: [], now: NOW });
    expect(out.map((one) => one.feature.id)).toEqual(['two', 'one']);
    expect(out[0].built.map((step) => step.id)).toEqual(['two-a', 'two-b']);
  });

  it('leaves out a feature with a session going or held by the stall check', () => {
    expect(
      featuresToLand(plan(), { runningIds: ['two'], heldIds: ['one'], now: NOW }),
    ).toEqual([]);
  });

  it('does not send a second land run inside the retry window, and does after it', () => {
    const recent = new Date(NOW - 60 * 60_000).toISOString();
    const old = new Date(NOW - (LAND_RETRY_AFTER_MINUTES + 1) * 60_000).toISOString();
    expect(
      featuresToLand(plan(), { runningIds: [], lastLandAt: { two: recent }, now: NOW }).map(
        (one) => one.feature.id,
      ),
    ).toEqual(['one']);
    expect(
      featuresToLand(plan(), { runningIds: [], lastLandAt: { two: old }, now: NOW }).map(
        (one) => one.feature.id,
      ),
    ).toEqual(['two', 'one']);
  });
});

describe('landTurn', () => {
  it('names the feature and each built step, and how to decline', () => {
    const text = landTurn({ outline: '2815', title: 'Built steps reach main' }, [
      { outline: '2815.1', title: 'Built steps stay built' },
    ]);
    expect(text).toContain('Land plan feature #2815, "Built steps reach main"');
    expect(text).toContain('- #2815.1 Built steps stay built');
    expect(text).toContain("When the feature's steps are built");
    expect(text).toContain('plan.ts stopped 2815');
    expect(text).toContain('plan.ts land 2815');
    expect(text).toContain('do not build or claim any step');
  });
});

describe('landNowLine', () => {
  it('says nothing below four built steps and tells the batch to land at four', () => {
    expect(LAND_AT_BUILT).toBe(4);
    expect(landNowLine('#2815', 3)).toBeNull();
    expect(landNowLine('#2815', 4)).toContain('#2815 now holds 4 built steps. Stop sending steps');
  });
});
