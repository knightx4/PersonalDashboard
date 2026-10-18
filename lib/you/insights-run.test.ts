import { describe, expect, it } from 'vitest';
import type { InsightRun } from '@/lib/you/insights';
import { INSIGHT_RUN_STALE_AFTER_MS, insightRunState, STALE_RUN_ERROR } from '@/lib/you/insights-run';

const NOW = Date.parse('2026-10-18T12:00:00Z');

const run = (status: InsightRun['status'], requestedAt = '2026-10-18T11:30:00Z', error: string | null = null): InsightRun => ({
  id: 'r1',
  status,
  summary: null,
  error,
  runUrl: null,
  requestedAt,
  startedAt: null,
  finishedAt: null,
});

describe('insightRunState', () => {
  it('is none before the first run', () => {
    expect(insightRunState(null, NOW)).toEqual({ kind: 'none' });
  });

  it('reads queued and running as running', () => {
    expect(insightRunState(run('queued'), NOW).kind).toBe('running');
    expect(insightRunState(run('running'), NOW).kind).toBe('running');
  });

  it('reads a run left going past the stale mark as failed', () => {
    const asked = new Date(NOW - INSIGHT_RUN_STALE_AFTER_MS - 1000).toISOString();
    expect(insightRunState(run('running', asked), NOW)).toMatchObject({ kind: 'failed', error: STALE_RUN_ERROR });
  });

  it('carries a failed run’s error, with a fallback', () => {
    expect(insightRunState(run('failed', undefined, 'Overloaded'), NOW)).toMatchObject({ kind: 'failed', error: 'Overloaded' });
    expect(insightRunState(run('failed'), NOW)).toMatchObject({ kind: 'failed', error: 'The last run did not finish.' });
  });

  it('reads ready as ready', () => {
    expect(insightRunState(run('ready'), NOW).kind).toBe('ready');
  });
});
