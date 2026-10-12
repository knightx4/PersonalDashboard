import { describe, expect, it } from 'vitest';
import { reviewChangeLine } from '@/lib/goals/review-change';
import type { ProgressSnapshot } from '@/lib/progress-snapshot';

const snap = (over: Partial<ProgressSnapshot>): ProgressSnapshot => ({
  v: 1,
  open: 3,
  done: 1,
  total: 4,
  blocked: 0,
  openIds: ['a', 'b', 'c'],
  dueOn: '2026-11-03',
  ...over,
});
const earlier = { createdAt: '2026-10-08T05:00:00Z', snapshot: snap({}) };

describe('reviewChangeLine', () => {
  it('names steps closed, added and a moved due date', () => {
    const newest = {
      createdAt: '2026-10-12T05:00:00Z',
      snapshot: snap({ openIds: ['c', 'd'], open: 2, done: 3, total: 5, dueOn: '2026-11-20' }),
    };
    expect(reviewChangeLine(newest, earlier)).toBe(
      'Since 8 Oct: 2 steps closed, 1 added, due date moved from 3 Nov to 20 Nov.',
    );
  });

  it('says nothing changed', () => {
    const newest = { createdAt: '2026-10-12T05:00:00Z', snapshot: snap({}) };
    expect(reviewChangeLine(newest, earlier)).toBe('Since 8 Oct: nothing has changed.');
  });

  it('shows nothing without two snapshots', () => {
    const old = { createdAt: '2026-10-01T05:00:00Z', snapshot: null };
    expect(reviewChangeLine(earlier, old)).toBeNull();
    expect(reviewChangeLine(earlier, null)).toBeNull();
  });
});
