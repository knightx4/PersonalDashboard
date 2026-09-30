import { describe, expect, it } from 'vitest';
import type { TimelineEvent } from '@/lib/timeline/timeline';
import {
  weekBounds,
  weekFacts,
  weekJustGone,
  type ChargeRow,
  type GoalItemRow,
  type GoalReviewRow,
  type SuggestionRow,
  type WeekFact,
  type WeekRows,
} from './facts';

// Clocks go back in New York at 2am on Sunday 1 November 2026, so the week
// starting that day is 169 hours long and the one before it 168.
const WEEK = '2026-11-01';
const LAST = '2026-10-25';

let seq = 0;
function event(kind: TimelineEvent['kind'], at: string, extra: Partial<TimelineEvent> = {}): TimelineEvent {
  seq += 1;
  const kindModule =
    kind === 'ordered' || kind === 'returned'
      ? 'shopping'
      : ['applied', 'rejected', 'offer', 'withdrew', 'interviewed'].includes(kind)
        ? 'jobs'
        : kind === 'task_done'
          ? 'todo'
          : kind === 'note_written'
            ? 'vault'
            : kind === 'step_done' || kind === 'goal_done'
              ? 'goals'
              : 'learn';
  return {
    occurred_at: at,
    module: kindModule,
    kind,
    title: `${kind} ${seq}`,
    detail: null,
    amount_cents: null,
    currency: null,
    source_table: `t.${kindModule}`,
    source_id: `e${seq}`,
    link_ref: null,
    ...extra,
  } as TimelineEvent;
}

const items: GoalItemRow[] = [
  { id: 'g1', parent_id: null, level: 'goal', status: 'open', title: 'Find a job' },
  { id: 'g2', parent_id: null, level: 'goal', status: 'open', title: 'Read more' },
  { id: 'g3', parent_id: null, level: 'goal', status: 'open', title: 'Run a half marathon' },
  { id: 'g4', parent_id: null, level: 'goal', status: 'done', title: 'Move flat' },
  { id: 's1', parent_id: 'g1', level: 'step', status: 'open', title: 'Go to meetups' },
  { id: 's2', parent_id: 's1', level: 'step', status: 'open', title: 'The October one' },
];

function review(id: string, item: string, verdict: string, at: string): GoalReviewRow {
  return { id, item_id: item, verdict, reason: `${verdict} because`, created_at: at };
}

function suggestion(id: string, extra: Partial<SuggestionRow>): SuggestionRow {
  return { id, item_id: null, title: id, happens_on: null, starts_at: null, reaction: 'going', attended: null, ...extra };
}

function charge(id: string, event: string, day: string, cents: number | null, previous: number | null = null): ChargeRow {
  return { id, event, amount_cents: cents, previous_amount_cents: previous, currency: 'USD', occurred_on: day };
}

function twoWeeks(): WeekRows {
  seq = 0;
  return {
    timeline: [
      // This week.
      event('applied', '2026-11-02T14:00:00Z'),
      event('applied', '2026-11-03T14:00:00Z'),
      event('rejected', '2026-11-04T14:00:00Z'),
      event('offer', '2026-11-05T14:00:00Z'),
      event('interviewed', '2026-11-05T16:00:00Z'),
      event('ordered', '2026-11-02T17:00:00Z', { amount_cents: 5000, currency: 'USD', source_id: 'o1', source_table: 'public.orders' }),
      event('ordered', '2026-11-03T17:00:00Z', { amount_cents: 1200, currency: 'GBP', source_id: 'o2', source_table: 'public.orders' }),
      event('returned', '2026-11-04T17:00:00Z', { amount_cents: 1500, currency: 'USD', source_id: 'r1', source_table: 'public.returns' }),
      event('reading_finished', '2026-11-03T01:00:00Z'),
      event('probe_answered', '2026-11-03T02:00:00Z'),
      event('quiz_answered', '2026-11-03T03:00:00Z'),
      event('step_done', '2026-11-06T15:00:00Z', { link_ref: 'g1' }),
      event('step_done', '2026-11-06T16:00:00Z', { link_ref: 'g4' }),
      // Saturday 23:30 EST, after the clock change: still this week.
      event('note_written', '2026-11-08T04:30:00Z', { source_id: 'late', source_table: 'obsidian.notes' }),
      // Sunday 00:00 EST: next week.
      event('note_written', '2026-11-08T05:00:00Z', { source_id: 'next', source_table: 'obsidian.notes' }),

      // Last week.
      event('applied', '2026-10-27T14:00:00Z'),
      event('rejected', '2026-10-28T14:00:00Z'),
      event('ordered', '2026-10-27T16:00:00Z', { amount_cents: 2000, currency: 'USD' }),
      event('task_done', '2026-10-29T16:00:00Z'),
      // Saturday 23:30 EDT, before the clock change: last week, not this one.
      event('note_written', '2026-11-01T03:30:00Z', { source_id: 'sat', source_table: 'obsidian.notes' }),
    ],
    suggestions: [
      suggestion('meetup', { item_id: 's2', starts_at: '2026-11-04T23:00:00Z' }),
      suggestion('missed', { item_id: 'g2', starts_at: '2026-11-05T23:00:00Z', attended: false }),
      suggestion('declined', { starts_at: '2026-11-05T23:00:00Z', reaction: 'not_for_me' }),
      suggestion('went unmarked', { reaction: null, attended: true, happens_on: '2026-11-07' }),
      suggestion('fair', { item_id: 'g3', happens_on: '2026-10-31' }),
    ],
    charges: [
      charge('c1', 'charge', '2026-11-03', 999),
      charge('c2', 'bill', '2026-11-04', 65300),
      charge('c3', 'price_change', '2026-11-05', 1099, 999),
      charge('c4', 'price_change', '2026-11-05', 899, 999),
      charge('c5', 'charge', '2026-10-27', 999),
      charge('c6', 'charge', '2026-11-08', 999),
    ],
    items,
    links: [
      { item_id: 'g1', kind: 'job_search' },
      { item_id: 'g2', kind: 'aim' },
      { item_id: 'g4', kind: 'role' },
    ],
    reviews: [
      review('v1', 'g1', 'stalled', '2026-10-28T12:00:00Z'),
      review('v2', 'g1', 'on_track', '2026-11-03T12:00:00Z'),
      review('v3', 'g3', 'stalled', '2026-10-30T12:00:00Z'),
      review('v4', 'g3', 'stalled', '2026-11-06T12:00:00Z'),
      review('v5', 'g2', 'stalled', '2026-11-05T12:00:00Z'),
      review('v6', 'g2', 'on_track', '2026-11-08T12:00:00Z'),
      review('v7', 'g4', 'stalled', '2026-11-05T12:00:00Z'),
    ],
  };
}

function figures(facts: readonly WeekFact[]) {
  return Object.fromEntries(facts.map((fact) => [fact.id, [fact.value, fact.previous]]));
}

describe('the week', () => {
  it('runs from local midnight on Sunday to local midnight a week later, across a clock change', () => {
    expect(weekBounds(WEEK)).toEqual({ from: '2026-11-01T04:00:00.000Z', to: '2026-11-08T05:00:00.000Z' });
    expect(weekBounds(LAST)).toEqual({ from: '2026-10-25T04:00:00.000Z', to: '2026-11-01T04:00:00.000Z' });
  });

  it('refuses a week that does not start on a Sunday', () => {
    expect(() => weekBounds('2026-11-02')).toThrow(/Sunday/);
  });

  it('is the whole week before the one now falls in, in New York', () => {
    // Sunday 9am EST.
    expect(weekJustGone(new Date('2026-11-08T14:00:00Z'))).toBe(WEEK);
    // Saturday 23:30 EST, though already Sunday in UTC.
    expect(weekJustGone(new Date('2026-11-08T04:30:00Z'))).toBe(LAST);
  });
});

describe('weekFacts, counted fresh', () => {
  const facts = weekFacts(WEEK, twoWeeks());

  it('gives the count per module beside last week', () => {
    expect(facts.previousFrom).toBe('counted');
    expect(figures(facts.facts)).toEqual({
      'jobs.applied': [2, 1],
      'jobs.replies': [2, 1],
      'jobs.interviews': [1, 0],
      'events.attended': [2, 1],
      'shopping.orders': [2, 1],
      'money.spent.GBP': [1200, 0],
      'money.spent.USD': [5999, 2999],
      'money.refunded.USD': [1500, 0],
      'money.bills': [1, 0],
      'money.rises': [1, 0],
      'learn.readings': [1, 0],
      'learn.checks': [2, 0],
      'vault.notes': [1, 1],
      'todo.tasks': [0, 1],
      'goals.steps': [2, 0],
      'goals.reached': [0, 0],
      'goals.stalled': [2, 2],
    });
  });

  it('gives spend per currency, orders and charges together, in minor units', () => {
    const usd = facts.facts.find((fact) => fact.id === 'money.spent.USD')!;
    expect(usd).toMatchObject({ module: 'shopping', currency: 'USD', label: 'spent in USD' });
    expect(usd.evidence).toEqual(['public.orders:o1', 'public.recurring_charges:c1']);
  });

  it('names the stalled goals, and whether each was stalled last week', () => {
    expect(facts.stalled).toEqual([
      { goalId: 'g2', title: 'Read more', reason: 'stalled because', stalledLastWeek: false, evidence: 'goals.reviews:v5' },
      { goalId: 'g3', title: 'Run a half marathon', reason: 'stalled because', stalledLastWeek: true, evidence: 'goals.reviews:v4' },
    ]);
  });

  it('ties each figure to the open goals it bears on', () => {
    const goals = Object.fromEntries(facts.facts.map((fact) => [fact.id, fact.goalIds]));
    expect(goals['jobs.applied']).toEqual(['g1']);
    expect(goals['learn.checks']).toEqual(['g2']);
    expect(goals['events.attended']).toEqual(['g1']);
    expect(goals['goals.steps']).toEqual(['g1']);
    expect(goals['goals.stalled']).toEqual(['g2', 'g3']);
    expect(goals['vault.notes']).toEqual([]);
    expect(facts.goals.map((goal) => goal.title)).toEqual(['Find a job', 'Read more', 'Run a half marathon']);
  });

  it('keeps the week edges in local time: the late Saturday note counts, the Sunday one does not', () => {
    const notes = facts.facts.find((fact) => fact.id === 'vault.notes')!;
    expect(notes.evidence).toEqual(['obsidian.notes:late']);
  });
});

describe('weekFacts, with last week stored', () => {
  it("takes last week's figures from its review where it has them, and counts the rest fresh", () => {
    const previous = {
      week: LAST,
      facts: [
        { id: 'jobs.applied', value: 7 },
        { id: 'money.spent.EUR', value: 400 },
      ],
      stalled: [{ goalId: 'g2' }],
    };
    const facts = weekFacts(WEEK, twoWeeks(), { previous });
    const byId = figures(facts.facts);
    expect(facts.previousFrom).toBe('review');
    expect(byId['jobs.applied']).toEqual([2, 7]);
    expect(byId['jobs.replies']).toEqual([2, 1]);
    // A fact only the stored review names is not listed without this week's shape to give it.
    expect(byId['money.spent.EUR']).toBeUndefined();
    expect(facts.stalled.map((goal) => [goal.title, goal.stalledLastWeek])).toEqual([
      ['Read more', true],
      ['Run a half marathon', false],
    ]);
  });

  it('ignores stored facts for some other week', () => {
    const facts = weekFacts(WEEK, twoWeeks(), { previous: { week: '2026-10-18', facts: [{ id: 'jobs.applied', value: 7 }] } });
    expect(facts.previousFrom).toBe('counted');
    expect(figures(facts.facts)['jobs.applied']).toEqual([2, 1]);
  });
});

describe('a quiet week', () => {
  it('lists every count at zero and no money', () => {
    const facts = weekFacts(WEEK, { timeline: [], suggestions: [], charges: [], items: [], links: [], reviews: [] });
    expect(facts.facts.every((fact) => fact.value === 0 && fact.previous === 0)).toBe(true);
    expect(facts.facts.some((fact) => fact.id.startsWith('money.spent'))).toBe(false);
    expect(facts.stalled).toEqual([]);
  });
});
