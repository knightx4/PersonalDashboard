import { describe, expect, it } from 'vitest';
import { deriveApplicationState, type PipelineEvent } from '@/lib/jobs/pipeline';

/**
 * A pursuit reopened by hand stays open when the employer writes again, and
 * the mail that arrived while it was closed stops asking to be reviewed
 * (job_search 0079).
 */
const NOW = new Date('2026-11-09T19:00:00Z');
const at = (iso: string) => new Date(iso);

const closed: PipelineEvent = { kind: 'withdrawal', occurredAt: at('2026-09-01T13:28:26Z'), source: 'system' };
const lateInvite: PipelineEvent = { kind: 'screen_scheduled', occurredAt: at('2026-10-30T12:18:57Z'), source: 'email' };
const reopen: PipelineEvent = {
  kind: 'status_override',
  occurredAt: at('2026-11-01T19:47:02Z'),
  source: 'manual',
  payload: { status: 'in_process' },
};
const nextEmail: PipelineEvent = { kind: 'interview_scheduled', occurredAt: at('2026-11-09T11:45:31Z'), source: 'email' };

describe('reopening a closed pursuit by hand', () => {
  it('flags mail that arrives after the close while nobody has reopened it', () => {
    const state = deriveApplicationState([closed, lateInvite], { now: NOW });
    expect(state.status).toBe('withdrawn');
    expect(state.flaggedEventIndexes).toEqual([1]);
  });

  it('clears the flags on mail that arrived before the reopen', () => {
    const state = deriveApplicationState([closed, lateInvite, reopen], { now: NOW, manualOverride: 'in_process' });
    expect(state.status).toBe('in_process');
    expect(state.flaggedEventIndexes).toEqual([]);
  });

  it('stays open when the employer writes after the reopen', () => {
    // The email clears the override column's hold; the reopen in the events still counts.
    const state = deriveApplicationState([closed, lateInvite, reopen, nextEmail], {
      now: NOW,
      manualOverride: 'in_process',
    });
    expect(state.status).toBe('in_process');
    expect(state.closedAt).toBeNull();
    expect(state.outcome).toBeNull();
    expect(state.flaggedEventIndexes).toEqual([]);
  });
});
