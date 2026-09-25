import { describe, expect, it } from 'vitest';
import {
  STALLED_AFTER_DAYS,
  goalActivity,
  latestByGoal,
  reviewGoals,
  reviewLines,
  toReview,
  type GoalReview,
} from '@/lib/goals/reviews';
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
    stepId: null,
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

  it('leaves out goals that are not open, and carries last week’s verdict', () => {
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
  it('states the done-when, the last thing done and last week’s verdict', () => {
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
      '- Nothing done in 21 days or more: the verdict is stalled, with a proposed next step.',
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
      step_id: 's',
      run_id: null,
      created_at: '2026-09-24T12:00:00Z',
    };
    expect(toReview(row)).toMatchObject({ goalId: 'g', verdict: 'stalled', nextMove: 'Call.', stepId: 's' });
    expect(toReview({ ...row, verdict: 'done' })).toBeNull();
  });
});
