import { describe, expect, it } from 'vitest';
import {
  RUN_QUIET_AFTER_MINUTES,
  isResolvingAnswers,
  lastRunLine,
  readingColumns,
  readingFor,
  runEnd,
  runQuietNote,
  storedReading,
  withReadings,
  type LastRun,
} from './run-end';

const fired = '2026-09-17T02:00:00.000Z';
const at = (minutes: number) => new Date(fired).getTime() + minutes * 60_000;

describe('runEnd', () => {
  it('leaves a run alone while it may still be working', () => {
    expect(runEnd({ status: 'started', createdAt: fired }, null, at(1))).toBeNull();
    expect(
      runEnd({ status: 'started', createdAt: fired }, null, at(RUN_QUIET_AFTER_MINUTES - 1)),
    ).toBeNull();
  });

  it('counts a run nothing has been heard from as failed', () => {
    expect(
      runEnd({ status: 'started', createdAt: fired }, null, at(RUN_QUIET_AFTER_MINUTES)),
    ).toBe('failed');
    expect(runEnd({ status: 'started', createdAt: fired }, null, at(60 * 96))).toBe('failed');
  });

  it('counts a run whose step closed after it as finished', () => {
    const step = { completedAt: '2026-09-17T02:40:00.000Z' };
    expect(runEnd({ status: 'started', createdAt: fired }, step, at(50))).toBe('finished');
  });

  it('prefers the step over the clock, so a long run that shipped is not a failure', () => {
    const step = { completedAt: '2026-09-17T05:00:00.000Z' };
    expect(runEnd({ status: 'started', createdAt: fired }, step, at(60 * 40))).toBe('finished');
  });

  it('ignores a step that closed before the run was fired', () => {
    const step = { completedAt: '2026-09-16T22:00:00.000Z' };
    expect(runEnd({ status: 'started', createdAt: fired }, step, at(10))).toBeNull();
    expect(runEnd({ status: 'started', createdAt: fired }, step, at(60 * 5))).toBe('failed');
  });

  it('leaves a run that has already ended where it is', () => {
    for (const status of ['finished', 'failed']) {
      expect(runEnd({ status, createdAt: fired }, null, at(60 * 40))).toBeNull();
    }
  });

  it('ends nothing at the clock pre-mount value', () => {
    expect(runEnd({ status: 'started', createdAt: fired }, null, 0)).toBeNull();
  });
});

describe('runQuietNote', () => {
  it('says how long the silence ran', () => {
    expect(runQuietNote(fired, at(190))).toBe('Nothing was heard from this run for 3h 10m.');
  });
});

describe('lastRunLine', () => {
  const run = (over: Partial<LastRun> = {}): LastRun => ({
    status: 'started',
    createdAt: fired,
    error: null,
    job: 'step',
    reading: null,
    ...over,
  });

  it('says how long a run has been going', () => {
    expect(lastRunLine(run(), at(45))).toBe('A run has been going 45m');
  });

  it('says nothing about a clock it does not have yet', () => {
    expect(lastRunLine(run(), 0)).toBe('A run is going');
  });

  it('says a run finished', () => {
    expect(lastRunLine(run({ status: 'finished' }), at(60))).toBe('Last run finished');
  });

  it('gives the reason a run stopped', () => {
    expect(
      lastRunLine(run({ status: 'failed', error: 'Anthropic answered 401.' }), at(60)),
    ).toBe('Last run stopped: Anthropic answered 401.');
  });

  it('says so when a stopped run kept no reason', () => {
    expect(lastRunLine(run({ status: 'failed' }), at(60))).toBe(
      'Last run stopped: no reason recorded',
    );
  });
});

describe('isResolvingAnswers', () => {
  const reshape = (over: Partial<LastRun> = {}): LastRun => ({
    status: 'started',
    createdAt: fired,
    error: null,
    job: 'reshape',
    reading: null,
    ...over,
  });

  it('is true while the re-shape the answer fired is still going', () => {
    expect(isResolvingAnswers(reshape(), at(1))).toBe(true);
    expect(isResolvingAnswers(reshape(), at(RUN_QUIET_AFTER_MINUTES - 1))).toBe(true);
  });

  it('clears once the run is past the cutoff', () => {
    expect(isResolvingAnswers(reshape(), at(RUN_QUIET_AFTER_MINUTES))).toBe(false);
  });

  it('clears the moment the run is written back as over', () => {
    expect(isResolvingAnswers(reshape({ status: 'finished' }), at(1))).toBe(false);
    expect(isResolvingAnswers(reshape({ status: 'failed' }), at(1))).toBe(false);
  });

  it('is not every run: a build session on the feature is not resolving anything', () => {
    expect(isResolvingAnswers(reshape({ job: 'step' }), at(1))).toBe(false);
    expect(isResolvingAnswers(reshape({ job: 'feature' }), at(1))).toBe(false);
  });

  it('holds before the clock has mounted, so the two renders agree', () => {
    expect(isResolvingAnswers(reshape(), 0)).toBe(true);
  });

  it('is false where there is no run at all', () => {
    expect(isResolvingAnswers(null, at(1))).toBe(false);
    expect(isResolvingAnswers(undefined, at(1))).toBe(false);
  });
});

describe('storedReading', () => {
  const checked = '2026-09-17T02:30:00.000Z';

  it('is nothing at all on a run nobody has asked about', () => {
    expect(
      storedReading({
        github_checked_at: null,
        last_push_at: null,
        last_push_sha: null,
        last_push_subject: null,
        github_error: null,
      }),
    ).toBeNull();
    expect(storedReading({})).toBeNull();
  });

  it('reads a run that was asked about and had pushed nothing', () => {
    expect(
      storedReading({
        github_checked_at: checked,
        last_push_at: null,
        last_push_sha: null,
        last_push_subject: null,
        github_error: null,
      }),
    ).toEqual({ checkedAt: checked, lastPush: null, refusal: null });
  });

  it('reads the push it last saw, with the commit and its subject', () => {
    expect(
      storedReading({
        github_checked_at: checked,
        last_push_at: '2026-09-17T02:20:00.000Z',
        last_push_sha: 'abc1234',
        last_push_subject: 'Store what GitHub last said about a run (plan #568)',
        github_error: null,
      }),
    ).toEqual({
      checkedAt: checked,
      lastPush: {
        at: '2026-09-17T02:20:00.000Z',
        sha: 'abc1234',
        subject: 'Store what GitHub last said about a run (plan #568)',
      },
      refusal: null,
    });
  });

  it('keeps a refusal apart from having seen no pushes', () => {
    const refused = storedReading({
      github_checked_at: checked,
      last_push_at: null,
      last_push_sha: null,
      last_push_subject: null,
      github_error: 'GitHub answered 401. Bad credentials',
    });

    expect(refused).toEqual({
      checkedAt: checked,
      lastPush: null,
      refusal: 'GitHub answered 401. Bad credentials',
    });
  });

  it('takes a push whose commit was never named', () => {
    expect(
      storedReading({ github_checked_at: checked, last_push_at: '2026-09-17T02:20:00.000Z' }),
    ).toEqual({
      checkedAt: checked,
      lastPush: { at: '2026-09-17T02:20:00.000Z', sha: null, subject: null },
      refusal: null,
    });
  });
});

describe('readingFor', () => {
  const checked = '2026-09-17T02:30:00.000Z';
  const push = { at: '2026-09-17T02:22:00.000Z', sha: 'abc1234', subject: 'Did a thing' };

  it('keeps the push GitHub answered with', () => {
    expect(readingFor({ checkedAt: checked, lastPush: push })).toEqual({
      checkedAt: checked,
      lastPush: push,
      refusal: null,
    });
  });

  it('is a reading with no push when GitHub answered and the run had pushed nothing', () => {
    expect(readingFor({ checkedAt: checked })).toEqual({
      checkedAt: checked,
      lastPush: null,
      refusal: null,
    });
  });

  it('drops the push on a refusal, so the row is one reading rather than two', () => {
    expect(
      readingFor({ checkedAt: checked, lastPush: push, refusal: 'GITHUB_READ_TOKEN was rejected' }),
    ).toEqual({
      checkedAt: checked,
      lastPush: null,
      refusal: 'GITHUB_READ_TOKEN was rejected',
    });
  });
});

describe('readingColumns', () => {
  const checked = '2026-09-17T02:30:00.000Z';

  it('sets the check on every reading, which is what says one was taken', () => {
    expect(readingColumns(readingFor({ checkedAt: checked }))).toEqual({
      github_checked_at: checked,
      last_push_at: null,
      last_push_sha: null,
      last_push_subject: null,
      github_error: null,
    });
  });

  it('spreads a push across the three columns it is kept in', () => {
    const columns = readingColumns(
      readingFor({
        checkedAt: checked,
        lastPush: {
          at: '2026-09-17T02:22:00.000Z',
          sha: 'abc1234',
          subject: 'Refresh run state from a route the page calls (plan #569)',
        },
      }),
    );

    expect(columns).toEqual({
      github_checked_at: checked,
      last_push_at: '2026-09-17T02:22:00.000Z',
      last_push_sha: 'abc1234',
      last_push_subject: 'Refresh run state from a route the page calls (plan #569)',
      github_error: null,
    });
  });

  it('writes a refusal beside the check and nothing else', () => {
    expect(
      readingColumns(readingFor({ checkedAt: checked, refusal: 'GitHub answered 403' })),
    ).toEqual({
      github_checked_at: checked,
      last_push_at: null,
      last_push_sha: null,
      last_push_subject: null,
      github_error: 'GitHub answered 403',
    });
  });

  it('keeps a subject within what the column takes', () => {
    const columns = readingColumns(
      readingFor({
        checkedAt: checked,
        lastPush: { at: checked, sha: 'abc1234', subject: 'x'.repeat(900) },
      }),
    );
    expect(columns.last_push_subject).toHaveLength(500);
  });

  it('stores an empty sha as no sha, so the column holds a commit or nothing', () => {
    const columns = readingColumns(
      readingFor({ checkedAt: checked, lastPush: { at: checked, sha: '', subject: null } }),
    );
    expect(columns.last_push_at).toBe(checked);
    expect(columns.last_push_sha).toBeNull();
  });

  it('is read back as the reading it was written from', () => {
    const reading = readingFor({
      checkedAt: checked,
      lastPush: { at: '2026-09-17T02:22:00.000Z', sha: 'abc1234', subject: 'Did a thing' },
    });
    expect(storedReading(readingColumns(reading))).toEqual(reading);
  });
});

describe('withReadings', () => {
  const run: LastRun = {
    status: 'started',
    createdAt: '2026-09-17T02:00:00.000Z',
    error: null,
    job: 'step',
    reading: null,
  };
  const fresh = readingFor({ checkedAt: '2026-09-17T02:30:00.000Z' });

  it('writes a fresher reading over the one the page drew with', () => {
    const merged = withReadings({ 'step-1': run }, { 'step-1': fresh });
    expect(merged['step-1'].reading).toEqual(fresh);
    expect(merged['step-1'].status).toBe('started');
  });

  it('leaves a run nothing was read about alone', () => {
    const merged = withReadings({ 'step-1': run, 'step-2': run }, { 'step-1': fresh });
    expect(merged['step-2'].reading).toBeNull();
  });

  it('invents no run for a reading about a step the page never loaded', () => {
    expect(withReadings({}, { 'step-9': fresh })).toEqual({});
  });
});
