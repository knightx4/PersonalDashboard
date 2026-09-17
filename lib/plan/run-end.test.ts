import { describe, expect, it } from 'vitest';
import {
  RUN_QUIET_AFTER_MINUTES,
  lastRunLine,
  runEnd,
  runQuietNote,
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
