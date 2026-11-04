import { describe, expect, it } from 'vitest';
import { deriveApplicationState, type PipelineEvent } from '@/lib/jobs/pipeline';

/**
 * An application sent with no submitted event recorded still has a day it
 * went out (job_search 0078), so the Goals rhythm and the funnel's cohorts
 * count it.
 */
const NOW = new Date('2026-10-29T12:00:00Z');
const at = (iso: string) => new Date(iso);
const derive = (events: PipelineEvent[]) =>
  deriveApplicationState(events, { now: NOW, ghostThresholdDays: 30 });

describe('submittedAt without a submitted event', () => {
  it('takes the confirmation when that is the first record', () => {
    const state = derive([
      { kind: 'confirmation', occurredAt: at('2026-10-28T16:53:55Z'), source: 'email' },
    ]);
    expect(state.status).toBe('acknowledged');
    expect(state.submittedAt).toEqual(at('2026-10-28T16:53:55Z'));
  });

  it('takes a move by hand to a stage past sending', () => {
    const state = deriveApplicationState(
      [
        {
          kind: 'status_override',
          occurredAt: at('2026-10-28T06:37:37Z'),
          source: 'manual',
          payload: { status: 'acknowledged' },
        },
      ],
      { now: NOW, manualOverride: 'acknowledged' },
    );
    expect(state.submittedAt).toEqual(at('2026-10-28T06:37:37Z'));
  });

  it('ignores a move to drafting', () => {
    const state = deriveApplicationState(
      [
        {
          kind: 'status_override',
          occurredAt: at('2026-10-28T06:37:37Z'),
          source: 'manual',
          payload: { status: 'drafting' },
        },
      ],
      { now: NOW, manualOverride: 'drafting' },
    );
    expect(state.submittedAt).toBeNull();
  });

  it('keeps the submitted event when there is one', () => {
    const state = derive([
      { kind: 'submitted', occurredAt: at('2026-10-26T10:00:00Z'), source: 'manual' },
      { kind: 'confirmation', occurredAt: at('2026-10-26T10:05:00Z'), source: 'email' },
    ]);
    expect(state.submittedAt).toEqual(at('2026-10-26T10:00:00Z'));
  });
});
