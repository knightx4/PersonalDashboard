import { describe, expect, it } from 'vitest';
import { activeRun, STALE_RUN_MS } from '@/lib/vault/sync/manual';
import type { SyncRunSummary } from '@/lib/vault/sync/progress';

const NOW = Date.parse('2026-09-02T12:00:00Z');

const run = (over: Partial<SyncRunSummary> = {}): SyncRunSummary => ({
  id: 'r1',
  type: 'incremental',
  status: 'running',
  notesSeen: 0,
  notesWritten: 0,
  notesDeleted: 0,
  notesSkipped: 0,
  startedAt: new Date(NOW - 30_000).toISOString(),
  finishedAt: null,
  error: null,
  ...over,
});

describe('whether a hand-pressed sync may start', () => {
  it('lets one start when nothing is in flight', () => {
    expect(activeRun([], NOW)).toBeNull();
    expect(activeRun([run({ status: 'completed' })], NOW)).toBeNull();
    expect(activeRun([run({ status: 'failed' })], NOW)).toBeNull();
  });

  it('defers to a run that started moments ago', () => {
    expect(activeRun([run()], NOW)?.id).toBe('r1');
    expect(activeRun([run({ status: 'queued' })], NOW)?.id).toBe('r1');
  });

  it('treats a row older than a whole run budget as abandoned', () => {
    const stale = run({ startedAt: new Date(NOW - STALE_RUN_MS - 1).toISOString() });
    expect(activeRun([stale], NOW)).toBeNull();
  });

  it('does not trample a run it cannot date', () => {
    expect(activeRun([run({ startedAt: null })], NOW)?.id).toBe('r1');
  });

  it('looks past a finished run to an older one still marked running', () => {
    const finished = run({ id: 'newer', status: 'completed' });
    const live = run({ id: 'older' });
    expect(activeRun([finished, live], NOW)?.id).toBe('older');
  });
});
