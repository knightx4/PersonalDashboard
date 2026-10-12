import { describe, expect, it } from 'vitest';
import {
  diffSnapshots,
  isUnchanged,
  parseSnapshot,
  type ProgressSnapshot,
} from './progress-snapshot';

const snap = (over: Partial<ProgressSnapshot> = {}): ProgressSnapshot => ({
  v: 1,
  open: 2,
  done: 1,
  total: 3,
  blocked: 0,
  openIds: ['a', 'b'],
  dueOn: null,
  ...over,
});

describe('parseSnapshot', () => {
  it('reads what the database writes and sorts the ids', () => {
    const raw = { v: 1, open: 2, done: 0, total: 2, blocked: 1, openIds: ['b', 'a'], dueOn: '2026-12-31' };
    expect(parseSnapshot(raw)).toEqual({ ...raw, openIds: ['a', 'b'] });
  });
  it('gives null for a missing, partial or wrong-shaped snapshot', () => {
    expect(parseSnapshot(null)).toBeNull();
    expect(parseSnapshot([])).toBeNull();
    expect(parseSnapshot({ v: 2 })).toBeNull();
    expect(parseSnapshot({ v: 1, open: 1, done: 0, total: 1, blocked: 0, openIds: [1] })).toBeNull();
    expect(parseSnapshot({ v: 1, open: -1, done: 0, total: 1, blocked: 0, openIds: [] })).toBeNull();
  });
  it('treats an absent due date as none', () => {
    const raw = { v: 1, open: 0, done: 0, total: 0, blocked: 0, openIds: [] };
    expect(parseSnapshot(raw)?.dueOn).toBeNull();
  });
});

describe('diffSnapshots', () => {
  it('names steps closed and steps added', () => {
    const diff = diffSnapshots(snap(), snap({ done: 2, total: 4, openIds: ['b', 'c'] }));
    expect(diff.closed).toEqual(['a']);
    expect(diff.added).toEqual(['c']);
    expect(diff.doneChange).toBe(1);
    expect(diff.totalChange).toBe(1);
  });
  it('does not call a step closed when it left and the done count did not rise', () => {
    const diff = diffSnapshots(snap(), snap({ open: 1, total: 2, openIds: ['b'] }));
    expect(diff.closed).toEqual([]);
    expect(diff.totalChange).toBe(-1);
  });
  it('reports a moved, set or cleared due date', () => {
    const moved = diffSnapshots(snap({ dueOn: '2026-10-01' }), snap({ dueOn: '2026-11-01' }));
    expect(moved.dueMoved).toEqual({ from: '2026-10-01', to: '2026-11-01' });
    expect(diffSnapshots(snap(), snap({ dueOn: '2026-11-01' })).dueMoved).toEqual({
      from: null,
      to: '2026-11-01',
    });
    expect(diffSnapshots(snap({ dueOn: '2026-11-01' }), snap()).dueMoved?.to).toBeNull();
  });
  it('is unchanged between identical snapshots', () => {
    const diff = diffSnapshots(snap(), snap());
    expect(diff.dueMoved).toBeNull();
    expect(isUnchanged(diff)).toBe(true);
  });
});
