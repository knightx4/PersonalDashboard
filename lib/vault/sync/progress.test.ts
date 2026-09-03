import { describe, expect, it } from 'vitest';
import { describeRun, syncProgress, type SyncRunSummary } from '@/lib/vault/sync/progress';

const run = (over: Partial<SyncRunSummary> = {}): SyncRunSummary => ({
  id: 'r1',
  type: 'backfill',
  status: 'completed',
  notesSeen: 0,
  notesWritten: 0,
  notesDeleted: 0,
  notesSkipped: 0,
  startedAt: '2026-09-02T10:00:00Z',
  finishedAt: '2026-09-02T10:04:00Z',
  error: null,
  ...over,
});

describe('vault sync progress', () => {
  it('says nothing has happened yet when no run exists', () => {
    const progress = syncProgress({ mirrored: 0, backfillCompletedAt: null, runs: [] });
    expect(progress.phase).toBe('never_run');
    expect(progress.percent).toBeNull();
  });

  it('measures a first sync against the tree the backfill walked', () => {
    const progress = syncProgress({
      mirrored: 240,
      backfillCompletedAt: null,
      runs: [run({ notesSeen: 1000, notesWritten: 240 })],
    });
    expect(progress.phase).toBe('first_sync');
    expect(progress.total).toBe(1000);
    expect(progress.percent).toBe(24);
    expect(progress.detail).toContain('240 of 1000 notes mirrored');
  });

  it('leaves the bar off rather than guessing a total', () => {
    const progress = syncProgress({
      mirrored: 12,
      backfillCompletedAt: null,
      runs: [run({ notesSeen: 0, status: 'running' })],
    });
    expect(progress.phase).toBe('running');
    expect(progress.total).toBeNull();
    expect(progress.percent).toBeNull();
    expect(progress.detail).toBe('12 notes mirrored so far.');
  });

  it('treats a queued or running row as in flight', () => {
    for (const status of ['queued', 'running'] as const) {
      expect(
        syncProgress({ mirrored: 1, backfillCompletedAt: null, runs: [run({ status })] }).phase,
      ).toBe('running');
    }
  });

  it('does not measure a finished vault against an incremental run', () => {
    // notes_seen on an update counts only what changed; using it would show a
    // 4,000-note vault as three notes on a quiet day.
    const progress = syncProgress({
      mirrored: 4000,
      backfillCompletedAt: '2026-09-01T00:00:00Z',
      runs: [run({ type: 'incremental', notesSeen: 3, notesWritten: 3 })],
    });
    expect(progress.phase).toBe('up_to_date');
    expect(progress.total).toBe(4000);
    expect(progress.percent).toBe(100);
    expect(progress.detail).toBe('3 notes updated.');
  });

  it('reports a failed run without emptying the bar behind it', () => {
    // The mirror is still complete; it is the update that failed, and the
    // headline is where that gets said.
    const progress = syncProgress({
      mirrored: 40,
      backfillCompletedAt: '2026-09-01T00:00:00Z',
      runs: [run({ type: 'incremental', status: 'failed', error: 'Bad credentials' })],
    });
    expect(progress.phase).toBe('failed');
    expect(progress.headline).toBe('Last sync failed');
    expect(progress.detail).toBe('Bad credentials');
    expect(progress.percent).toBe(100);
  });

  it('shows a first sync that failed part way as part way', () => {
    const progress = syncProgress({
      mirrored: 30,
      backfillCompletedAt: null,
      runs: [run({ status: 'failed', notesSeen: 300, error: 'Rate limited' })],
    });
    expect(progress.phase).toBe('failed');
    expect(progress.percent).toBe(10);
  });

  it('never runs the bar past the end', () => {
    // More rows than the last backfill counted: a note added since.
    const progress = syncProgress({
      mirrored: 120,
      backfillCompletedAt: null,
      runs: [run({ notesSeen: 100 })],
    });
    expect(progress.percent).toBe(100);
  });
});

describe('describing one run', () => {
  it('says what changed, and says so when nothing did', () => {
    expect(describeRun(run({ notesWritten: 1 }))).toBe('1 note updated.');
    expect(describeRun(run({ notesWritten: 4, notesDeleted: 2, notesSkipped: 1 }))).toBe(
      '4 notes updated, 2 removed, 1 skipped.',
    );
    expect(describeRun(run())).toBe('Nothing had changed.');
  });

  it('prefers the error on a failed run', () => {
    expect(describeRun(run({ status: 'failed', error: 'Rate limited' }))).toBe('Rate limited');
    expect(describeRun(run({ status: 'failed', error: null }))).toBe(
      'Failed without saying why.',
    );
  });
});
