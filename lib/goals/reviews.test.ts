import { describe, expect, it } from 'vitest';
import type { GoalsSupabaseClient } from '@/lib/goals/db/schema-name';
import {
  REVIEW_CURRENT_HOURS,
  STALLED_AFTER_DAYS,
  VERDICTS,
  VERDICT_LABELS,
  goalActivity,
  isCurrent,
  latestByGoal,
  reviewGoals,
  reviewLines,
  toReview,
  type GoalReview,
  type ReviewRow,
} from '@/lib/goals/reviews';
import { REVIEWS_SHOWN_FOR_DAYS, loadLatestReviews } from '@/lib/goals/reviews-store';
import type { Goal } from '@/lib/goals/tree';

const NOW = Date.parse('2026-10-01T12:00:00Z');

function goal(over: Partial<Goal>): Goal {
  return {
    id: 'g',
    areaId: 'a',
    title: 'Pay off the cards',
    acceptance: 'Both cards at zero.',
    fog: null,
    status: 'open',
    position: 10,
    unit: null,
    target: null,
    ...over,
  };
}

function review(over: Partial<GoalReview>): GoalReview {
  return {
    id: 'r',
    goalId: 'g',
    verdict: 'on_track',
    reason: 'Two steps closed this week.',
    nextMove: 'Pay the Visa.',
    nextOn: null,
    stepId: null,
    waitsOnId: null,
    runId: 'run-1',
    createdAt: '2026-09-24T12:00:00Z',
    ...over,
  };
}

describe('goalActivity', () => {
  const items = [
    { id: 'g', parent_id: null, level: 'goal', status: 'open', approved_at: '2026-08-01T00:00:00Z' },
    { id: 'p', parent_id: 'g', level: 'step', status: 'open' },
    { id: 's1', parent_id: 'p', level: 'step', status: 'done', closed_at: '2026-09-10T09:00:00Z' },
    { id: 's2', parent_id: 'g', level: 'step', status: 'dropped', closed_at: '2026-09-28T09:00:00Z' },
    { id: 'h', parent_id: null, level: 'goal', status: 'open', created_at: '2026-09-20T00:00:00Z' },
  ];

  it('takes the newest step done anywhere under the goal, and ignores a dropped one', () => {
    const activity = goalActivity(items, []);
    expect(activity.get('g')).toEqual({ lastDoneAt: '2026-09-10T09:00:00Z', since: '2026-08-01T00:00:00Z' });
  });

  it('counts a reading on the goal or a step as something done', () => {
    const activity = goalActivity(items, [{ item_id: 'p', created_at: '2026-09-15T00:00:00Z' }]);
    expect(activity.get('g')?.lastDoneAt).toBe('2026-09-15T00:00:00Z');
  });

  it('falls back to when the goal was added when it has no approval', () => {
    expect(goalActivity(items, []).get('h')).toEqual({ lastDoneAt: null, since: '2026-09-20T00:00:00Z' });
  });
});

describe('reviewGoals', () => {
  it('reads three weeks with nothing done as stalled', () => {
    const activity = new Map([
      ['g', { lastDoneAt: '2026-09-09T12:00:00Z', since: '2026-08-01T00:00:00Z' }],
      ['h', { lastDoneAt: '2026-09-11T12:00:00Z', since: '2026-08-01T00:00:00Z' }],
    ]);
    const [stale, moving] = reviewGoals(
      [goal({ id: 'g' }), goal({ id: 'h', title: 'Run a 10k' })],
      activity,
      new Map(),
      NOW,
    );
    expect(stale).toMatchObject({ id: 'g', quietDays: STALLED_AFTER_DAYS + 1, stalled: true });
    expect(moving).toMatchObject({ id: 'h', quietDays: 20, stalled: false });
  });

  it('measures a goal with nothing done from its approval, so a new goal is not stalled', () => {
    const activity = new Map([['g', { lastDoneAt: null, since: '2026-09-25T00:00:00Z' }]]);
    expect(reviewGoals([goal({})], activity, new Map(), NOW)[0]).toMatchObject({ quietDays: 6, stalled: false });
  });

  it('leaves out goals that are not open, and carries the last verdict', () => {
    const last = review({ verdict: 'waiting_on_you' });
    const goals = reviewGoals(
      [goal({}), goal({ id: 'x', status: 'proposed' }), goal({ id: 'd', status: 'done' })],
      new Map(),
      new Map([['g', last]]),
      NOW,
    );
    expect(goals.map((g) => g.id)).toEqual(['g']);
    expect(goals[0].last).toBe(last);
    expect(goals[0].quietDays).toBeNull();
  });
});

describe('reviewLines', () => {
  it('states the done-when, the last thing done and the last verdict', () => {
    const lines = reviewLines({
      id: 'g',
      title: 'Pay off the cards',
      acceptance: 'Both cards at zero.',
      lastDoneAt: '2026-09-20T09:00:00Z',
      quietDays: 11,
      stalled: false,
      last: review({ verdict: 'waiting_on_you', reason: 'The rate question is yours.' }),
    });
    expect(lines).toEqual([
      'Goal "Pay off the cards" (goals.items id g)',
      '- Done when: Both cards at zero.',
      '- Last thing done: 2026-09-20, 11 days ago.',
      '- Last verdict (2026-09-24): waiting on you. The rate question is yours.',
    ]);
  });

  it('says a quiet goal must read stalled', () => {
    const lines = reviewLines({
      id: 'g',
      title: 'Pay off the cards',
      acceptance: null,
      lastDoneAt: null,
      quietDays: 40,
      stalled: true,
      last: null,
    });
    expect(lines).toContain('- Done when: not written yet');
    expect(lines).toContain('- Nothing done since it was approved 40 days ago.');
    expect(lines).toContain(
      '- Nothing done in 21 days or more: the verdict is stalled, with its next step added under it, unless its done-when is met.',
    );
  });

  it('says when the person kept a goal open against a proposal', () => {
    const lines = reviewLines({
      id: 'g',
      title: 'Pay off the cards',
      acceptance: 'Both cards at zero.',
      lastDoneAt: null,
      quietDays: 3,
      stalled: false,
      last: null,
      keptOpenAt: '2026-09-24T18:00:00Z',
    });
    expect(lines).toContain(
      '- The person kept it open on 2026-09-24 rather than close or park it. Read it as met again only on something done since then.',
    );
  });
});

describe('rows', () => {
  it('keeps the newest review of each goal', () => {
    const older = review({ id: 'old', createdAt: '2026-09-17T12:00:00Z' });
    const newer = review({ id: 'new' });
    const other = review({ id: 'h1', goalId: 'h' });
    const latest = latestByGoal([older, newer, other]);
    expect(latest.get('g')?.id).toBe('new');
    expect(latest.get('h')?.id).toBe('h1');
  });

  it('drops a row with a verdict it does not know', () => {
    const row = {
      id: 'r',
      item_id: 'g',
      verdict: 'stalled',
      reason: 'Quiet.',
      next_move: 'Call.',
      next_on: null,
      step_id: 's',
      waits_on_id: null,
      run_id: null,
      created_at: '2026-09-24T12:00:00Z',
    };
    expect(toReview(row)).toMatchObject({ goalId: 'g', verdict: 'stalled', nextMove: 'Call.', stepId: 's' });
    expect(toReview({ ...row, verdict: 'done' })).toBeNull();
  });

  it('reads the two waiting verdicts with their date and the goal waited on', () => {
    const base = {
      id: 'r',
      item_id: 'g',
      reason: 'Nothing can move before the info session.',
      next_move: 'Go to the TA info session.',
      step_id: null,
      run_id: 'run-1',
      created_at: '2026-09-26T12:00:00Z',
    };
    expect(
      toReview({ ...base, verdict: 'waiting_on_date', next_on: '2026-10-02', waits_on_id: null }),
    ).toMatchObject({ verdict: 'waiting_on_date', nextOn: '2026-10-02', waitsOnId: null });
    expect(toReview({ ...base, verdict: 'waiting_on_goal', next_on: null, waits_on_id: 'h' })).toMatchObject({
      verdict: 'waiting_on_goal',
      nextOn: null,
      waitsOnId: 'h',
    });
  });

  it('labels all six verdicts', () => {
    expect(VERDICTS).toEqual(['on_track', 'stalled', 'waiting_on_you', 'waiting_on_date', 'waiting_on_goal', 'met']);
    expect(VERDICTS.map((v) => VERDICT_LABELS[v])).toEqual([
      'On track',
      'Stalled',
      'Waiting on you',
      'Waiting on a date',
      'Waiting on another goal',
      'Done-when met',
    ]);
  });
});

describe('isCurrent', () => {
  it('holds a status written in the last day and a half, and no older', () => {
    const at = (hours: number) => new Date(NOW - hours * 60 * 60 * 1000).toISOString();
    expect(isCurrent(review({ createdAt: at(20) }), NOW)).toBe(true);
    expect(isCurrent(review({ createdAt: at(REVIEW_CURRENT_HOURS) }), NOW)).toBe(true);
    expect(isCurrent(review({ createdAt: at(REVIEW_CURRENT_HOURS + 1) }), NOW)).toBe(false);
  });
});

describe('loadLatestReviews', () => {
  function fakeClient(rows: ReviewRow[]) {
    const calls: { method: string; args: unknown[] }[] = [];
    const builder: Record<string, unknown> = {
      then(resolve: (value: unknown) => unknown) {
        return Promise.resolve({ data: rows, error: null }).then(resolve);
      },
    };
    for (const name of ['select', 'gte', 'eq', 'order']) {
      builder[name] = (...args: unknown[]) => {
        calls.push({ method: name, args });
        return builder;
      };
    }
    const client = {
      from: (table: string) => {
        calls.push({ method: 'from', args: [table] });
        return builder;
      },
    } as unknown as GoalsSupabaseClient;
    return { client, calls };
  }

  function row(over: Partial<ReviewRow>): ReviewRow {
    return {
      id: 'r',
      item_id: 'g',
      verdict: 'on_track',
      reason: 'Moving.',
      next_move: 'Send three applications.',
      next_on: null,
      step_id: null,
      waits_on_id: null,
      run_id: 'run-1',
      created_at: '2026-09-30T12:00:00Z',
      ...over,
    };
  }

  it('returns the newest status per goal, with the new verdicts, from the last four weeks', async () => {
    const { client, calls } = fakeClient([
      row({ id: 'g-old', created_at: '2026-09-29T12:00:00Z' }),
      row({ id: 'g-new', verdict: 'waiting_on_date', next_on: '2026-10-02' }),
      row({ id: 'h1', item_id: 'h', verdict: 'waiting_on_goal', waits_on_id: 'g' }),
      row({ id: 'x', item_id: 'x', verdict: 'retired' }),
    ]);
    const latest = await loadLatestReviews(client, { userId: 'u', now: NOW });

    expect([...latest.keys()].sort()).toEqual(['g', 'h']);
    expect(latest.get('g')).toMatchObject({ id: 'g-new', verdict: 'waiting_on_date', nextOn: '2026-10-02' });
    expect(latest.get('h')).toMatchObject({ verdict: 'waiting_on_goal', waitsOnId: 'g' });

    expect(calls).toContainEqual({ method: 'from', args: ['reviews'] });
    expect(calls).toContainEqual({ method: 'eq', args: ['user_id', 'u'] });
    const since = new Date(NOW - REVIEWS_SHOWN_FOR_DAYS * 24 * 60 * 60 * 1000).toISOString();
    expect(calls).toContainEqual({ method: 'gte', args: ['created_at', since] });
  });
});
