import { describe, expect, it } from 'vitest';
import { claimExpiredNote, claimHeldByRun, expiredClaim } from './claims';
import { STALLED_AFTER_MINUTES } from './elapsed';

const start = '2026-09-09T10:00:00.000Z';
const at = (minutes: number) => new Date(start).getTime() + minutes * 60_000;

const claim = (over: Partial<Parameters<typeof expiredClaim>[0]> = {}) => ({
  status: 'in_progress',
  startedAt: start,
  ...over,
});

describe('expiredClaim', () => {
  it('leaves a claim younger than the threshold alone', () => {
    expect(expiredClaim(claim(), at(1))).toBeNull();
    expect(expiredClaim(claim(), at(STALLED_AFTER_MINUTES - 1))).toBeNull();
  });

  it('calls a claim past the threshold stale', () => {
    expect(expiredClaim(claim(), at(STALLED_AFTER_MINUTES))).toBe('stale');
    expect(expiredClaim(claim(), at(60 * 40))).toBe('stale');
  });

  // The whole point of the sweep is that it only touches claims. A blocked
  // step is waiting on the person and a done one is finished; neither is a
  // session's to give back.
  it('ignores any status but in_progress', () => {
    for (const status of ['not_started', 'blocked', 'done', 'dropped', 'proposed']) {
      expect(expiredClaim(claim({ status }), at(60 * 40))).toBeNull();
    }
  });

  // `started_at` comes from a trigger, so a row without one was claimed this
  // instant -- the same reading `claimLiveness` makes.
  it('leaves a claim with no start time alone', () => {
    expect(expiredClaim(claim({ startedAt: null }), at(60 * 40))).toBeNull();
  });
});

describe('claimExpiredNote', () => {
  it('says how long the claim sat', () => {
    expect(claimExpiredNote(start, at(160))).toBe(
      'Claim expired 2026-09-09: nothing had touched it for 2h 40m, so it went back to not started.',
    );
  });

  it('says when GitHub could not be asked what the run pushed', () => {
    expect(claimExpiredNote(start, at(160), 'No GITHUB_READ_TOKEN is set.')).toBe(
      'Claim expired 2026-09-09: nothing had touched it for 2h 40m, so it went back to not' +
        ' started. GitHub could not be asked what its run pushed, so the clock decided alone.' +
        ' No GITHUB_READ_TOKEN is set.',
    );
  });

  // The refusals come from `listPushes` as whole sentences, but a bare reason
  // off a thrown error does not always end in a full stop.
  it('ends the refusal it repeats', () => {
    expect(claimExpiredNote(start, at(160), '  fetch failed  ')).toMatch(
      /the clock decided alone\. fetch failed\.$/,
    );
  });
});

describe('claimHeldByRun (plan #1825)', () => {
  const line = '2026-09-09T09:00:00.000Z';

  it('holds a claim while the run behind it writes lines and has not ended', () => {
    for (const status of ['started', 'awaiting_input', 'stale']) {
      expect(claimHeldByRun({ status, lastLineAt: line })).toBe(true);
    }
  });

  it('leaves the claim to the clock when the run ended or wrote no lines', () => {
    expect(claimHeldByRun({ status: 'failed', lastLineAt: line })).toBe(false);
    expect(claimHeldByRun({ status: 'finished', lastLineAt: line })).toBe(false);
    expect(claimHeldByRun({ status: 'started', lastLineAt: null })).toBe(false);
    expect(claimHeldByRun(null)).toBe(false);
  });
});
