import { describe, expect, it } from 'vitest';
import { visionReviewDue, visionReviewStatus, visionRunText } from './vision-review-run';

const NOW = Date.parse('2026-10-04T14:41:00Z');
const daysAgo = (days: number) => new Date(NOW - days * 24 * 60 * 60 * 1000).toISOString();

describe('visionReviewDue', () => {
  it('is due when nothing has run', () => {
    expect(visionReviewDue({ lastFire: null, lastReviewAt: null, now: NOW })).toEqual({ due: true });
  });

  it('is due a week after the last review', () => {
    expect(visionReviewDue({ lastFire: null, lastReviewAt: daysAgo(7), now: NOW }).due).toBe(true);
  });

  it('is not due when a review was written in the last six days', () => {
    expect(visionReviewDue({ lastFire: null, lastReviewAt: daysAgo(2), now: NOW }).due).toBe(false);
  });

  it('is not due when a fire started this week, before it has written anything', () => {
    const lastFire = { status: 'started' as const, at: daysAgo(0.01), error: null };
    expect(visionReviewDue({ lastFire, lastReviewAt: daysAgo(7), now: NOW }).due).toBe(false);
  });

  it('tries again after a fire that failed', () => {
    const lastFire = { status: 'failed' as const, at: daysAgo(0.01), error: '401' };
    expect(visionReviewDue({ lastFire, lastReviewAt: daysAgo(7), now: NOW }).due).toBe(true);
  });
});

describe('visionReviewStatus', () => {
  it('says nothing has run', () => {
    expect(visionReviewStatus({ lastFire: null, lastReviewAt: null, pendingEdits: 0 })).toEqual({
      lastRunAt: null,
      failed: null,
      nextAt: null,
      pendingEdits: 0,
    });
  });

  it('takes the newer of the review and the fire, and the next run a week on', () => {
    const status = visionReviewStatus({
      lastFire: { status: 'finished', at: '2026-10-04T14:41:00.000Z', error: null },
      lastReviewAt: '2026-09-27T16:00:00.000Z',
      pendingEdits: 2,
    });
    expect(status.lastRunAt).toBe('2026-10-04T14:41:00.000Z');
    expect(status.nextAt).toBe('2026-10-11T14:41:00.000Z');
    expect(status.failed).toBeNull();
    expect(status.pendingEdits).toBe(2);
  });

  it('says a failed fire after the last run, and does not count it as a run', () => {
    const status = visionReviewStatus({
      lastFire: { status: 'failed', at: '2026-10-04T14:41:00.000Z', error: 'Anthropic answered 401.' },
      lastReviewAt: '2026-09-27T16:00:00.000Z',
      pendingEdits: 0,
    });
    expect(status.lastRunAt).toBe('2026-09-27T16:00:00.000Z');
    expect(status.failed).toEqual({ at: '2026-10-04T14:41:00.000Z', error: 'Anthropic answered 401.' });
  });
});

describe('visionRunText', () => {
  it('names the account and the procedure', () => {
    const text = visionRunText('11111111-1111-4111-8111-111111111111');
    expect(text).toContain('user_id 11111111-1111-4111-8111-111111111111');
    expect(text).toContain('.claude/skills/vision-review/SKILL.md');
  });
});
