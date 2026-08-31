/**
 * The rule that keeps the sync chain alive.
 *
 * These are small, but they encode the failure that stopped three imports in a
 * row: a batch begun with time on the clock but not enough of it, killing the
 * function before it could hand off to the next invocation.
 */
import { describe, expect, it } from 'vitest';
import {
  BATCH_SLOWDOWN_ALLOWANCE,
  MIN_BATCH_RESERVE_MS,
  canStartAnotherBatch,
  nextBatchNeedsMs,
  shouldResumeBackfill,
} from '@/lib/core/inbox/pump-budget';

describe('nextBatchNeedsMs', () => {
  it('reserves the floor before anything has been measured', () => {
    expect(nextBatchNeedsMs(0)).toBe(MIN_BATCH_RESERVE_MS);
  });

  it('allows a slow batch room to be slower still', () => {
    expect(nextBatchNeedsMs(40_000)).toBe(Math.round(40_000 * BATCH_SLOWDOWN_ALLOWANCE));
  });

  it('never drops below the floor for a quick batch', () => {
    expect(nextBatchNeedsMs(1_000)).toBe(MIN_BATCH_RESERVE_MS);
  });

  it('treats nonsense measurements as no measurement', () => {
    expect(nextBatchNeedsMs(Number.NaN)).toBe(MIN_BATCH_RESERVE_MS);
    expect(nextBatchNeedsMs(-5)).toBe(MIN_BATCH_RESERVE_MS);
    expect(nextBatchNeedsMs(Number.POSITIVE_INFINITY)).toBe(MIN_BATCH_RESERVE_MS);
  });
});

describe('canStartAnotherBatch', () => {
  it('starts one when the budget covers a batch like the last', () => {
    expect(canStartAnotherBatch({ remainingMs: 60_000, slowestBatchMs: 40_000 })).toBe(true);
  });

  it('refuses the case that broke the chain: time left, but not a batch of time', () => {
    // 20s on the clock and batches have been taking 40s. The old test was
    // "deadline not passed", which said yes here and let the function be
    // killed 20s into a 40s batch -- taking the hand-off with it.
    expect(canStartAnotherBatch({ remainingMs: 20_000, slowestBatchMs: 40_000 })).toBe(false);
  });

  it('refuses when under the floor even with no batch measured yet', () => {
    expect(canStartAnotherBatch({ remainingMs: 5_000, slowestBatchMs: 0 })).toBe(false);
    expect(canStartAnotherBatch({ remainingMs: MIN_BATCH_RESERVE_MS, slowestBatchMs: 0 })).toBe(
      true,
    );
  });

  it('refuses once the deadline has passed', () => {
    expect(canStartAnotherBatch({ remainingMs: 0, slowestBatchMs: 0 })).toBe(false);
    expect(canStartAnotherBatch({ remainingMs: -1_000, slowestBatchMs: 5_000 })).toBe(false);
  });

  it('tightens as batches get slower, rather than trusting an average', () => {
    // A budget that comfortably fit 10s batches must stop offering to run one
    // once a batch has taken 60s: the worst case is what gets you killed.
    expect(canStartAnotherBatch({ remainingMs: 50_000, slowestBatchMs: 10_000 })).toBe(true);
    expect(canStartAnotherBatch({ remainingMs: 50_000, slowestBatchMs: 60_000 })).toBe(false);
  });
});

describe('shouldResumeBackfill', () => {
  it('resumes from a saved page token', () => {
    expect(shouldResumeBackfill({ savedPageToken: 'page-2' })).toBe(true);
  });

  it('starts over when there is nothing saved', () => {
    expect(shouldResumeBackfill({ savedPageToken: null })).toBe(false);
    expect(shouldResumeBackfill({ savedPageToken: undefined })).toBe(false);
    expect(shouldResumeBackfill({ savedPageToken: '' })).toBe(false);
  });

  it('starts over when a reset was actually asked for', () => {
    expect(shouldResumeBackfill({ savedPageToken: 'page-2', reset: true })).toBe(false);
  });

  it('does not treat a merely absent reset flag as a reset', () => {
    expect(shouldResumeBackfill({ savedPageToken: 'page-2', reset: false })).toBe(true);
    expect(shouldResumeBackfill({ savedPageToken: 'page-2', reset: undefined })).toBe(true);
  });
});
