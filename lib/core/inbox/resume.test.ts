import { describe, expect, it } from 'vitest';
import {
  backfillResumable,
  backfillRunning,
  scanButtonLabel,
  shouldAutoResume,
  MAX_STALLED_RESUMES,
  RESUME_COOLDOWN_MS,
  type BackfillState,
} from '@/lib/core/inbox/resume';

function state(over: Partial<BackfillState> = {}): BackfillState {
  return {
    accountStatus: 'active',
    backfillCompletedAt: null,
    latestJob: { status: 'failed', messagesSeen: 60 },
    ...over,
  };
}

describe('what the settings page says about a scan', () => {
  it('offers to resume a first scan that stopped partway', () => {
    // The reported bug: six attempts, hundreds of messages read, and the
    // button still read "Start the first scan".
    expect(scanButtonLabel(state())).toBe('Resume the first scan');
  });

  it('offers to start one that has never been run', () => {
    expect(scanButtonLabel(state({ latestJob: null }))).toBe('Start the first scan');
  });

  it('offers a re-scan once the window has been read', () => {
    expect(scanButtonLabel(state({ backfillCompletedAt: '2026-08-30T00:00:00Z' }))).toBe(
      'Re-scan everything',
    );
  });

  it('does not call a running scan resumable', () => {
    expect(backfillRunning(state({ latestJob: { status: 'running', messagesSeen: 12 } }))).toBe(
      true,
    );
    expect(backfillResumable(state({ latestJob: { status: 'queued', messagesSeen: 0 } }))).toBe(
      false,
    );
  });

  it('leaves a mailbox that needs reconnecting alone', () => {
    expect(backfillResumable(state({ accountStatus: 'needs_reauth' }))).toBe(false);
  });
});

describe('resuming on its own while a tab is open', () => {
  const base = { state: state(), stalledAttempts: 0, sinceLastAttemptMs: null };

  it('starts the next stretch of a scan that stopped', () => {
    expect(shouldAutoResume(base)).toBe(true);
  });

  it('waits out the cooldown rather than kicking a chain that just started', () => {
    expect(shouldAutoResume({ ...base, sinceLastAttemptMs: RESUME_COOLDOWN_MS - 1 })).toBe(false);
    expect(shouldAutoResume({ ...base, sinceLastAttemptMs: RESUME_COOLDOWN_MS })).toBe(true);
  });

  it('gives up after resumes that read nothing new', () => {
    // Otherwise a mailbox that cannot progress -- a revoked grant, a query that
    // matches nothing left -- is asked again every twenty seconds, forever.
    expect(shouldAutoResume({ ...base, stalledAttempts: MAX_STALLED_RESUMES })).toBe(false);
  });

  it('never starts a second scan over a running one', () => {
    expect(
      shouldAutoResume({
        ...base,
        state: state({ latestJob: { status: 'running', messagesSeen: 40 } }),
      }),
    ).toBe(false);
  });

  it('stops once the whole window has been read', () => {
    expect(
      shouldAutoResume({ ...base, state: state({ backfillCompletedAt: '2026-08-30T00:00:00Z' }) }),
    ).toBe(false);
  });
});
