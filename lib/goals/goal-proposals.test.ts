import { describe, expect, it } from 'vitest';
import { goalProposals, quietDays } from './goal-proposals';
import type { GoalActivity, GoalReview } from './reviews';

const NOW = Date.parse('2026-09-27T09:00:00Z');
const DAY = 24 * 60 * 60 * 1000;
const ago = (days: number) => new Date(NOW - days * DAY).toISOString();

function review(goalId: string, extra: Partial<GoalReview> = {}): GoalReview {
  return {
    id: `r-${goalId}`,
    goalId,
    verdict: 'met',
    reason: 'The last loan was paid off on 20 September.',
    nextMove: 'Close the goal.',
    nextOn: null,
    stepId: null,
    waitsOnId: null,
    runId: null,
    createdAt: ago(0.2),
    ...extra,
  };
}

const goal = (id: string, extra: { status?: 'open' | 'parked' | 'done'; keptOpenAt?: string | null } = {}) => ({
  id,
  title: id,
  status: extra.status ?? ('open' as const),
  keptOpenAt: extra.keptOpenAt ?? null,
});

const activity = (lastDoneDaysAgo: number | null, sinceDaysAgo = 60): GoalActivity => ({
  lastDoneAt: lastDoneDaysAgo === null ? null : ago(lastDoneDaysAgo),
  since: ago(sinceDaysAgo),
});

describe('goalProposals', () => {
  it('proposes closing a goal on a current met verdict, with its reason as the summary', () => {
    const out = goalProposals({
      goals: [goal('debt')],
      reviews: new Map([['debt', review('debt')]]),
      activity: new Map([['debt', activity(7)]]),
      now: NOW,
    });
    expect(out).toEqual([
      {
        kind: 'close',
        goalId: 'debt',
        goalTitle: 'debt',
        summary: 'The last loan was paid off on 20 September.',
      },
    ]);
  });

  it('does not propose closing on a stale met verdict, another verdict, or one older than keeping it open', () => {
    const out = goalProposals({
      goals: [goal('stale'), goal('track'), goal('kept', { keptOpenAt: ago(0.1) })],
      reviews: new Map([
        ['stale', review('stale', { createdAt: ago(3) })],
        ['track', review('track', { verdict: 'on_track' })],
        ['kept', review('kept')],
      ]),
      activity: new Map([
        ['stale', activity(2)],
        ['track', activity(2)],
        ['kept', activity(2)],
      ]),
      now: NOW,
    });
    expect(out).toEqual([]);
  });

  it('proposes parking a goal with nothing done in three weeks, counted from approval when nothing was', () => {
    const out = goalProposals({
      goals: [goal('quiet'), goal('never'), goal('busy'), goal('young')],
      reviews: new Map(),
      activity: new Map([
        ['quiet', activity(22)],
        ['never', activity(null, 30)],
        ['busy', activity(20)],
        ['young', activity(null, 10)],
      ]),
      now: NOW,
    });
    expect(out.map((p) => [p.kind, p.goalId])).toEqual([
      ['park', 'quiet'],
      ['park', 'never'],
    ]);
    expect(out[0]).toMatchObject({ quietDays: 22 });
  });

  it('counts the three weeks from keeping it open, and leaves parked and closed goals alone', () => {
    const out = goalProposals({
      goals: [
        goal('kept', { keptOpenAt: ago(5) }),
        goal('parked', { status: 'parked' }),
        goal('done', { status: 'done' }),
      ],
      reviews: new Map([['done', review('done')]]),
      activity: new Map([
        ['kept', activity(40)],
        ['parked', activity(40)],
        ['done', activity(40)],
      ]),
      now: NOW,
    });
    expect(out).toEqual([]);
  });

  it('offers closing rather than parking when a quiet goal reads met', () => {
    const out = goalProposals({
      goals: [goal('debt')],
      reviews: new Map([['debt', review('debt')]]),
      activity: new Map([['debt', activity(30)]]),
      now: NOW,
    });
    expect(out.map((p) => p.kind)).toEqual(['close']);
  });
});

describe('quietDays', () => {
  it('takes the latest of the last thing done, approval and keeping it open', () => {
    expect(quietDays(activity(10), ago(3), NOW)).toBe(3);
    expect(quietDays(activity(10), null, NOW)).toBe(10);
    expect(quietDays(activity(null, 25), null, NOW)).toBe(25);
    expect(quietDays(undefined, null, NOW)).toBeNull();
  });
});
