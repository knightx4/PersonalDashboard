import { describe, expect, it } from 'vitest';
import type { PlanItem } from '@/lib/plan/load';
import { buildPlanTree, flattenSections } from '@/lib/plan/tree';
import {
  changeSincePrevious,
  planUpdateFromRow,
  progressSince,
  updateCounts,
  updateOverdueDays,
} from './updates';

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

describe('changeSincePrevious', () => {
  const snap = (openIds: string[], done: number, total: number) => ({
    v: 1 as const,
    open: openIds.length,
    done,
    total,
    blocked: 0,
    openIds,
    dueOn: null,
  });
  it('has nothing to say without an earlier update', () => {
    expect(changeSincePrevious({ stepsDoneAfter: 1, stepsTotal: 2, snapshot: null }, null)).toBeNull();
  });
  it('counts closed, added and removed from the snapshots', () => {
    const earlier = { stepsDoneAfter: 1, stepsTotal: 4, snapshot: snap(['a', 'b', 'c'], 1, 4) };
    const later = { stepsDoneAfter: 2, stepsTotal: 4, snapshot: snap(['d', 'e'], 2, 4) };
    // a left and was closed; b and c left unfinished; d and e are new.
    expect(changeSincePrevious(later, earlier)).toBe(
      'Since the update before: 1 step closed, 2 added, 2 removed.',
    );
  });
  it('falls back to the stored totals for updates with no snapshot', () => {
    const earlier = { stepsDoneAfter: 1, stepsTotal: 4, snapshot: null };
    expect(changeSincePrevious({ stepsDoneAfter: 3, stepsTotal: 5, snapshot: null }, earlier)).toBe(
      'Since the update before: 2 steps closed, 1 added.',
    );
    expect(changeSincePrevious({ stepsDoneAfter: 1, stepsTotal: 3, snapshot: null }, earlier)).toBe(
      'Since the update before: 1 removed.',
    );
  });
  it('says so when nothing moved', () => {
    const same = { stepsDoneAfter: 1, stepsTotal: 4, snapshot: null };
    expect(changeSincePrevious(same, same)).toMatch(/No change/);
  });
});

describe('updateOverdueDays', () => {
  const day = 24 * 60 * 60 * 1000;
  const feature = (startedAt: string | null) => ({ startedAt, children: [] });
  it('flags a moving feature seven days after its last update', () => {
    expect(updateOverdueDays(feature(null), 'in_progress', new Date(NOW - 7 * day).toISOString(), NOW)).toBe(7);
    expect(updateOverdueDays(feature(null), 'working', new Date(NOW - 6 * day).toISOString(), NOW)).toBeNull();
  });
  it('counts from the start when there is no update', () => {
    expect(updateOverdueDays(feature(new Date(NOW - 9 * day).toISOString()), 'in_progress', undefined, NOW)).toBe(9);
    expect(updateOverdueDays(feature(null), 'in_progress', undefined, NOW)).toBeNull();
  });
  it('leaves a feature that is not moving alone', () => {
    expect(updateOverdueDays(feature(null), 'not_started', new Date(NOW - 30 * day).toISOString(), NOW)).toBeNull();
    expect(updateOverdueDays(feature(null), 'done', new Date(NOW - 30 * day).toISOString(), NOW)).toBeNull();
  });
});
