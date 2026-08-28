import { describe, expect, it } from 'vitest';
import {
  STALE_QUEUED_MS,
  STALE_RUNNING_MS,
  isFreshActiveJob,
} from '@/lib/core/inbox/sync-job-stale';

describe('isFreshActiveJob', () => {
  const now = Date.parse('2026-07-29T00:00:00.000Z');

  it('treats recent queued jobs as active', () => {
    expect(
      isFreshActiveJob(
        {
          status: 'queued',
          updated_at: new Date(now - 30_000).toISOString(),
        },
        now,
      ),
    ).toBe(true);
  });

  it('treats queued jobs older than STALE_QUEUED_MS as stale', () => {
    expect(
      isFreshActiveJob(
        {
          status: 'queued',
          updated_at: new Date(now - STALE_QUEUED_MS - 1).toISOString(),
        },
        now,
      ),
    ).toBe(false);
  });

  it('keeps running jobs active until STALE_RUNNING_MS', () => {
    expect(
      isFreshActiveJob(
        {
          status: 'running',
          updated_at: new Date(now - STALE_RUNNING_MS + 60_000).toISOString(),
        },
        now,
      ),
    ).toBe(true);
    expect(
      isFreshActiveJob(
        {
          status: 'running',
          updated_at: new Date(now - STALE_RUNNING_MS - 1).toISOString(),
        },
        now,
      ),
    ).toBe(false);
  });

  it('ignores completed and failed jobs', () => {
    expect(
      isFreshActiveJob(
        { status: 'failed', updated_at: new Date(now).toISOString() },
        now,
      ),
    ).toBe(false);
    expect(
      isFreshActiveJob(
        { status: 'completed', updated_at: new Date(now).toISOString() },
        now,
      ),
    ).toBe(false);
  });
});
