import { describe, expect, it } from 'vitest';
import type { WeekFact, WeekFacts } from './facts';
import { checkReview, isQuietWeek, plainReview, reviewPrompt, reviewWeekDue } from './review';

function fact(overrides: Partial<WeekFact> & Pick<WeekFact, 'id'>): WeekFact {
  return {
    module: 'jobs',
    label: overrides.id,
    value: 0,
    previous: 0,
    currency: null,
    goalIds: [],
    evidence: [],
    ...overrides,
  };
}

const FACTS: WeekFacts = {
  week: '2026-09-20',
  timezone: 'America/New_York',
  from: '2026-09-20T04:00:00.000Z',
  to: '2026-09-27T04:00:00.000Z',
  previousFrom: 'counted',
  facts: [
    fact({
      id: 'jobs.applied',
      label: 'applications sent',
      value: 4,
      previous: 7,
      goalIds: ['goal-job'],
      evidence: ['jobs.applications:a1', 'jobs.applications:a2'],
    }),
    fact({ id: 'jobs.replies', label: 'replies received', value: 1, previous: 0, evidence: ['jobs.applications:a3'] }),
    fact({
      id: 'money.spent.USD',
      module: 'shopping',
      label: 'spent in USD',
      value: 12040,
      previous: 8000,
      currency: 'USD',
      evidence: ['shopping.orders:o1'],
    }),
    fact({ id: 'vault.notes', module: 'vault', label: 'notes written', value: 0, previous: 0 }),
    fact({ id: 'goals.stalled', module: 'goals', label: 'goals stalled', value: 1, previous: 1, goalIds: ['goal-fit'] }),
  ],
  stalled: [
    { goalId: 'goal-fit', title: 'Run a 10k', reason: 'No steps in a month.', stalledLastWeek: true, evidence: 'goals.reviews:r1' },
  ],
  goals: [
    { id: 'goal-job', title: 'Find a product role' },
    { id: 'goal-fit', title: 'Run a 10k' },
  ],
};

describe('reviewWeekDue', () => {
  it('is due on Sunday from 9am New York time under daylight saving', () => {
    expect(reviewWeekDue(new Date('2026-09-27T12:59:00Z'))).toBeNull(); // 08:59 EDT
    expect(reviewWeekDue(new Date('2026-09-27T13:00:00Z'))).toBe('2026-09-20');
    expect(reviewWeekDue(new Date('2026-09-28T02:00:00Z'))).toBe('2026-09-20'); // 22:00 Sunday
  });

  it('keeps 9am after the clocks go back', () => {
    expect(reviewWeekDue(new Date('2026-11-08T13:30:00Z'))).toBeNull(); // 08:30 EST
    expect(reviewWeekDue(new Date('2026-11-08T14:00:00Z'))).toBe('2026-11-01');
  });

  it('is not due on any other day', () => {
    expect(reviewWeekDue(new Date('2026-09-28T15:00:00Z'))).toBeNull(); // Monday
    expect(reviewWeekDue(new Date('2026-09-26T15:00:00Z'))).toBeNull(); // Saturday
  });
});

describe('reviewPrompt', () => {
  it('lists goals by label, both weeks of every fact, stalled goals and last week', () => {
    const prompt = reviewPrompt(FACTS, { change: 'Apply to 5 roles.', observations: ['You sent 7 applications.'] }, [
      'You spent more after rejections.',
    ]);
    expect(prompt).toContain('G1 | Find a product role');
    expect(prompt).toContain('jobs.applied | applications sent | 4 | 7 | G1');
    expect(prompt).toContain('money.spent.USD | spent in USD | 120.40 USD | 80.00 USD | none');
    expect(prompt).toContain('G2 | Run a 10k | No steps in a month. | stalled last week too');
    expect(prompt).toContain('Change it set for this week: Apply to 5 roles.');
    expect(prompt).toContain('- You spent more after rejections.');
  });
});

describe('checkReview', () => {
  const previous = { change: 'Send at least 7 applications.', observations: [] };

  it('keeps observations whose numbers are figures of the facts they cite', () => {
    const { review, dropped } = checkReview(
      {
        observations: [
          { text: 'You sent 4 applications, down from 7, toward Find a product role.', facts: ['jobs.applied'], goal: 'G1' },
          { text: 'You spent $120.40 against 80 the week before.', facts: ['money.spent.USD'] },
          { text: 'Run a 10k has stalled for 1 week more.', facts: ['goals.stalled'], goal: 'G2' },
        ],
        change: 'Send 7 applications, as the week before.',
        last_change: 'not_kept',
      },
      FACTS,
      previous,
    );
    expect(dropped).toEqual([]);
    expect(review?.observations).toEqual([
      {
        text: 'You sent 4 applications, down from 7, toward Find a product role.',
        goal_id: 'goal-job',
        evidence: ['jobs.applications:a1', 'jobs.applications:a2'],
        facts: ['jobs.applied'],
      },
      { text: 'You spent $120.40 against 80 the week before.', goal_id: null, evidence: ['shopping.orders:o1'], facts: ['money.spent.USD'] },
      { text: 'Run a 10k has stalled for 1 week more.', goal_id: 'goal-fit', evidence: [], facts: ['goals.stalled'] },
    ]);
    expect(review?.change).toBe('Send 7 applications, as the week before.');
    expect(review?.change_kept).toBe(false);
  });

  it('drops a number that is not a figure of a cited fact, and a fact it was not given', () => {
    const { review, dropped } = checkReview(
      {
        observations: [
          { text: 'You sent 3 fewer applications.', facts: ['jobs.applied'] },
          { text: 'You got 1 reply.', facts: ['jobs.offers'] },
          { text: 'You got 1 reply against 7 applications.', facts: ['jobs.replies'] },
          { text: 'You got 1 reply.', facts: ['jobs.replies'], goal: 'G9' },
        ],
        change: 'Reply within a day.',
        last_change: 'kept',
      },
      FACTS,
      null,
    );
    expect(dropped).toEqual(['number-not-in-facts', 'unknown-fact', 'number-not-in-facts']);
    expect(review?.observations).toEqual([
      { text: 'You got 1 reply.', goal_id: null, evidence: ['jobs.applications:a3'], facts: ['jobs.replies'] },
    ]);
    // No change was set last week, so there is nothing to have kept.
    expect(review?.change_kept).toBeNull();
  });

  it('drops text with a fact id or goal label in it, or no number', () => {
    const { dropped } = checkReview(
      {
        observations: [
          { text: 'jobs.applied fell to 4.', facts: ['jobs.applied'] },
          { text: 'G1 moved with 4 applications.', facts: ['jobs.applied'] },
          { text: 'Fewer applications went out.', facts: ['jobs.applied'] },
        ],
        change: 'Apply more.',
        last_change: 'none',
      },
      FACTS,
      null,
    );
    expect(dropped).toEqual(['label-in-text', 'label-in-text', 'no-number']);
  });

  it('keeps at most five', () => {
    const one = { text: 'You got 1 reply.', facts: ['jobs.replies'] };
    const { review, dropped } = checkReview(
      { observations: [one, one, one, one, one, one], change: 'Reply within a day.', last_change: 'none' },
      FACTS,
      null,
    );
    expect(review?.observations).toHaveLength(5);
    expect(dropped).toEqual(['over-limit']);
  });

  it('gives nothing to store without an observation or a checkable change', () => {
    expect(checkReview({ observations: [], change: 'Apply more.' }, FACTS, null).review).toBeNull();
    expect(
      checkReview({ observations: [{ text: 'You got 1 reply.', facts: ['jobs.replies'] }], change: 'Apply to 12 roles.' }, FACTS, null)
        .review,
    ).toBeNull();
    expect(checkReview(null, FACTS, null).review).toBeNull();
  });
});

describe('plainReview', () => {
  it('writes the facts that moved with both figures, and a stalled goal as the change', () => {
    const review = plainReview(FACTS);
    expect(review.observations.map((item) => item.text)).toEqual([
      'Applications sent: 4 this week, against 7 the week before.',
      'Replies received: 1 this week, against 0 the week before.',
      'Spent in USD: 120.40 this week, against 80.00 the week before.',
    ]);
    expect(review.observations[0]).toMatchObject({ goal_id: 'goal-job', facts: ['jobs.applied'] });
    expect(review.change).toBe('Take one step on Run a 10k, which its latest review marks as stalled.');
    expect(review.change_kept).toBeNull();
  });

  it('passes its own number check', () => {
    const plain = plainReview(FACTS);
    const { review } = checkReview(
      {
        observations: plain.observations.map((item) => ({ text: item.text, facts: item.facts })),
        change: plain.change,
      },
      FACTS,
      null,
    );
    expect(review?.observations).toHaveLength(3);
  });

  it('says nothing on a week with nothing counted', () => {
    const quiet: WeekFacts = { ...FACTS, stalled: [], facts: [fact({ id: 'jobs.applied' })] };
    expect(isQuietWeek(quiet)).toBe(true);
    expect(isQuietWeek(FACTS)).toBe(false);
    expect(plainReview(quiet)).toEqual({ observations: [], change: null, change_kept: null });
  });
});
