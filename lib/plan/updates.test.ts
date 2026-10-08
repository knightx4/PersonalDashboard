import { describe, expect, it } from 'vitest';
import type { PlanItem } from '@/lib/plan/load';
import { buildPlanTree, flattenSections } from '@/lib/plan/tree';
import { planUpdateFromRow, progressSince, updateCounts } from './updates';

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

const NOW = Date.parse('2026-10-07T12:00:00Z');

const tree = buildPlanTree({
  items: [
    item({ id: 'f', title: 'Feature pages' }),
    item({ id: 'a', title: 'Layout', parentId: 'f', status: 'done', completedAt: '2026-10-01T09:00:00Z' }),
    item({ id: 'a1', title: 'Tabs', parentId: 'a', status: 'done', completedAt: '2026-10-07T09:00:00Z' }),
    item({ id: 'b', title: 'Page', parentId: 'f', status: 'done', completedAt: '2026-10-07T10:00:00Z' }),
    item({ id: 'c', title: 'Update', parentId: 'f', status: 'in_progress' }),
    item({ id: 'd', title: 'Side sheet', parentId: 'f', status: 'dropped', completedAt: '2026-10-02T00:00:00Z' }),
    item({ id: 'q', title: 'Folded?', parentId: 'f', kind: 'decision', status: 'done' }),
    item({ id: 's', title: 'Set a key', parentId: 'f', kind: 'setup' }),
  ],
  dependencies: [],
});
const feature = flattenSections(tree).find((node) => node.id === 'f')!;

describe("Dash's update on a feature", () => {
  it('counts steps and substeps, leaving out decisions, setup jobs and dropped steps', () => {
    expect(updateCounts(feature, '2026-10-05T00:00:00Z', NOW)).toEqual({
      before: 1,
      after: 3,
      total: 4,
    });
  });

  it('counts the first update from a day back', () => {
    expect(updateCounts(feature, null, NOW).before).toBe(1);
  });

  it('says where the done count stands and where it stood', () => {
    expect(progressSince({ stepsDoneBefore: 1, stepsDoneAfter: 3, stepsTotal: 4 })).toBe(
      '3 of 4 steps done, up from 1.',
    );
    expect(progressSince({ stepsDoneBefore: 3, stepsDoneAfter: 3, stepsTotal: 4 })).toBe(
      '3 of 4 steps done, no change.',
    );
    expect(progressSince({ stepsDoneBefore: 1, stepsDoneAfter: 0, stepsTotal: 1 })).toBe(
      '0 of 1 step done, down from 1.',
    );
  });

  it('reads a row, and refuses one that is not an update', () => {
    const row = {
      id: 'u',
      feature_id: 'f',
      health: 'at_risk',
      body: 'Two steps closed.',
      steps_done_before: 1,
      steps_done_after: 3,
      steps_total: 4,
      session: null,
      created_at: '2026-10-07T12:00:00Z',
    };
    expect(planUpdateFromRow(row)?.health).toBe('at_risk');
    expect(planUpdateFromRow({ ...row, health: 'off_track' })).toBeNull();
    expect(planUpdateFromRow({ ...row, steps_total: null })).toBeNull();
  });
});
