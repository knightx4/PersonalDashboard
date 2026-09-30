import { describe, expect, it } from 'vitest';
import type { TimelineEvent } from '@/lib/timeline/timeline';
import type { WeekFacts } from './facts';
import {
  lastChangeLine,
  nextReviewDay,
  parseWeek,
  reviewEvidenceByTable,
  showWeekReview,
  weekRangeLabel,
  type WeekReviewRecord,
} from './view';

const FACTS: WeekFacts = {
  week: '2026-09-20',
  timezone: 'America/New_York',
  from: '2026-09-20T04:00:00.000Z',
  to: '2026-09-27T04:00:00.000Z',
  previousFrom: 'review',
  facts: [
    {
      id: 'jobs.applied',
      module: 'jobs',
      label: 'applications sent',
      value: 4,
      previous: 7,
      currency: null,
      goalIds: ['goal-job'],
      evidence: ['job_search.application_events:e1'],
    },
    {
      id: 'money.spent.USD',
      module: 'shopping',
      label: 'spent in USD',
      value: 12040,
      previous: 8000,
      currency: 'USD',
      goalIds: [],
      evidence: ['public.orders:o1'],
    },
  ],
  stalled: [
    { goalId: 'goal-fit', title: 'Run a 10k', reason: 'No steps.', stalledLastWeek: true, evidence: 'goals.reviews:r1' },
  ],
  goals: [{ id: 'goal-job', title: 'Find a product role' }],
};

function record(overrides: Partial<WeekReviewRecord> = {}): WeekReviewRecord {
  return {
    week: '2026-09-20',
    facts: FACTS,
    observations: [
      {
        text: 'You sent 4 applications, down from 7.',
        goal_id: 'goal-job',
        evidence: ['job_search.application_events:e1', 'goals.suggestions:s1', 'job_search.application_events:e1'],
        facts: ['jobs.applied', 'no.such.fact'],
      },
      { text: 'Spending rose to $120.40 from $80.00.', goal_id: 'goal-gone', evidence: ['public.orders:o1'], facts: ['money.spent.USD'] },
      { text: 'Run a 10k stayed stalled.', goal_id: 'goal-fit', evidence: [], facts: [] },
    ],
    change: 'Send two applications by Wednesday.',
    change_kept: true,
    source: 'model',
    created_at: '2026-09-27T13:05:00.000Z',
    ...overrides,
  };
}

function event(table: string, id: string, at: string): TimelineEvent {
  return {
    occurred_at: at,
    module: 'jobs',
    kind: 'applied',
    title: id,
    detail: null,
    amount_cents: null,
    currency: null,
    source_table: table,
    source_id: id,
    link_ref: null,
  } as TimelineEvent;
}

describe('parseWeek', () => {
  it('takes a Sunday and refuses anything else', () => {
    expect(parseWeek('2026-09-20')).toBe('2026-09-20');
    expect(parseWeek('2026-09-21')).toBeNull();
    expect(parseWeek('2026-02-30')).toBeNull();
    expect(parseWeek('latest')).toBeNull();
  });
});

describe('weekRangeLabel', () => {
  it('names Sunday to Saturday, with the month once when it does not change', () => {
    expect(weekRangeLabel('2026-09-13')).toBe('13 to 19 September 2026');
    expect(weekRangeLabel('2026-09-27')).toBe('27 September to 3 October 2026');
    expect(weekRangeLabel('2026-12-27')).toBe('27 December 2026 to 2 January 2027');
  });
});

describe('nextReviewDay', () => {
  it('is the coming Sunday midweek', () => {
    expect(nextReviewDay(new Date('2026-09-30T15:00:00Z'))).toEqual({ day: '2026-10-04', due: false });
  });
  it('is today on a Sunday before 9am New York time, and due after it', () => {
    expect(nextReviewDay(new Date('2026-10-04T12:30:00Z'))).toEqual({ day: '2026-10-04', due: false });
    expect(nextReviewDay(new Date('2026-10-04T13:30:00Z'))).toEqual({ day: '2026-10-04', due: true });
  });
  it('reads the day in New York, not UTC', () => {
    // 02:00 UTC on Sunday is still Saturday evening in New York.
    expect(nextReviewDay(new Date('2026-10-04T02:00:00Z'))).toEqual({ day: '2026-10-04', due: false });
  });
});

describe('lastChangeLine', () => {
  it('says whether last week’s change happened, and nothing when there was none', () => {
    expect(lastChangeLine('Walk daily.', true)).toBe('Last week’s change happened: “Walk daily”.');
    expect(lastChangeLine('Walk daily', false)).toBe('Last week’s change did not happen: “Walk daily”.');
    expect(lastChangeLine('Walk daily', null)).toBe('Dash could not tell whether last week’s change happened: “Walk daily”.');
    expect(lastChangeLine(null, true)).toBeNull();
    expect(lastChangeLine('  ', null)).toBeNull();
  });
});

describe('reviewEvidenceByTable', () => {
  it('groups refs by table, once each', () => {
    const grouped = reviewEvidenceByTable(record().observations);
    expect(grouped.get('job_search.application_events')).toEqual(['e1']);
    expect(grouped.get('public.orders')).toEqual(['o1']);
    expect(grouped.get('goals.suggestions')).toEqual(['s1']);
  });
});

describe('showWeekReview', () => {
  const events = [
    event('job_search.application_events', 'e1', '2026-09-22T10:00:00Z'),
    event('public.orders', 'o1', '2026-09-23T10:00:00Z'),
  ];

  it('shows both weeks’ figures of the cited facts, money in its currency', () => {
    const shown = showWeekReview(record(), 'Walk daily.', events);
    expect(shown.observations[0].figures).toEqual([
      { id: 'jobs.applied', label: 'applications sent', value: '4', previous: '7' },
    ]);
    expect(shown.observations[1].figures).toEqual([
      { id: 'money.spent.USD', label: 'spent in USD', value: '$120.40', previous: '$80.00' },
    ]);
  });

  it('names the goal from the open goals or the stalled ones, and drops one it cannot name', () => {
    const shown = showWeekReview(record(), null, events);
    expect(shown.observations.map((observation) => observation.goal)).toEqual([
      { id: 'goal-job', title: 'Find a product role' },
      null,
      { id: 'goal-fit', title: 'Run a 10k' },
    ]);
  });

  it('finds the timeline rows behind each observation once each, leaving out refs not on it', () => {
    const shown = showWeekReview(record(), null, events);
    expect(shown.observations[0].events.map((row) => row.source_id)).toEqual(['e1']);
    expect(shown.observations[2].events).toEqual([]);
  });

  it('carries the change and the line on last week’s', () => {
    const shown = showWeekReview(record(), 'Walk daily.', events);
    expect(shown.change).toBe('Send two applications by Wednesday.');
    expect(shown.lastChange).toBe('Last week’s change happened: “Walk daily”.');
  });

  it('shows a quiet week as no observations and no change', () => {
    const shown = showWeekReview(record({ observations: [], change: null, change_kept: null, source: 'plain' }), null, []);
    expect(shown.observations).toEqual([]);
    expect(shown.change).toBeNull();
    expect(shown.lastChange).toBeNull();
  });
});
