import { describe, expect, it } from 'vitest';
import {
  decisionReviews,
  dueUnwritten,
  gradeReview,
  nextReview,
  openReviews,
  outcomeLabels,
  reviewAsk,
  pickOf,
  pickScorecard,
  reviewDates,
  reviewsOf,
  reviewsToJson,
  topicsLine,
  withOutcome,
  type BoardReview,
} from './board-reviews';

const review = (over: Partial<BoardReview> = {}): BoardReview => ({
  at: 30,
  option: 'A',
  meetingId: 'm1',
  writtenAt: '2026-11-29T18:41:00Z',
  account: 'You took the contract on 2 November.',
  receipts: [{ label: 'Roles', link: '/jobs/roles' }],
  ask: 'Did taking the contract go well?',
  outcome: null,
  answeredAt: null,
  grades: [],
  scores: [],
  ...over,
});

describe('reviewDates and nextReview', () => {
  it('puts the check-backs 30 and 90 days after the decision', () => {
    expect(reviewDates('2026-10-27T20:00:00Z')).toEqual([
      { at: 30, due: '2026-11-26' },
      { at: 90, due: '2027-01-25' },
    ]);
  });

  it('names the first one not yet written, then none', () => {
    expect(nextReview('2026-10-27T20:00:00Z', [])?.at).toBe(30);
    expect(nextReview('2026-10-27T20:00:00Z', [{ at: 30 }])?.at).toBe(90);
    expect(nextReview('2026-10-27T20:00:00Z', [{ at: 30 }, { at: 90 }])).toBeNull();
    expect(reviewDates('not a date')).toEqual([]);
  });
});

describe('reviewsOf', () => {
  it('reads what a session wrote and drops what it cannot', () => {
    const rows = reviewsOf([
      { at: 90, account: 'later', ask: 'And now?' },
      { at: 30, account: 'Took it.', option: 'A', receipts: [{ label: 'x', link: '/x' }, { label: '' }], outcome: 'well', answered_at: '2026-12-01T00:00:00Z', grades: [{ advisor: 'cfo', pick: 'A', held: true }] },
      { at: 30, account: 'a duplicate' },
      { at: 45, account: 'not a review day' },
      { at: 90 },
      'junk',
    ]);
    expect(rows.map((r) => r.at)).toEqual([30, 90]);
    expect(rows[0]).toMatchObject({ outcome: 'well', receipts: [{ label: 'x', link: '/x' }], grades: [{ advisor: 'cfo', held: true }] });
    expect(rows[1]).toMatchObject({ outcome: null, ask: 'And now?', grades: [] });
  });

  it('round-trips through the stored shape', () => {
    const one = review({ outcome: 'badly', answeredAt: '2026-12-01T00:00:00Z', grades: [{ advisor: 'mentor', pick: 'B', held: true }] });
    expect(reviewsOf(reviewsToJson([one]))).toEqual([one]);
  });
});

describe('pickOf and gradeReview', () => {
  it('takes the top score and refuses a tie', () => {
    expect(pickOf({ A: 3, B: 8, C: 5 })).toBe('B');
    expect(pickOf({ A: 7, B: 7 })).toBeNull();
    expect(pickOf({})).toBeNull();
    expect(pickOf(null)).toBeNull();
  });

  const scores = [
    { advisor: 'mentor', scores: { A: 8, B: 3 } },
    { advisor: 'skeptic', scores: { A: 2, B: 9 } },
    { advisor: 'cfo', scores: { A: 5, B: 5 } },
  ];

  it('holds up a pick of the decided option when it went well', () => {
    expect(gradeReview(scores, 'A', 'well')).toEqual([
      { advisor: 'mentor', pick: 'A', held: true },
      { advisor: 'skeptic', pick: 'B', held: false },
      { advisor: 'cfo', pick: null, held: null },
    ]);
  });

  it('holds up a pick of another option when it went badly', () => {
    expect(gradeReview(scores, 'A', 'badly').map((g) => g.held)).toEqual([false, true, null]);
  });

  it('grades nothing on a mixed outcome', () => {
    expect(gradeReview(scores, 'A', 'mixed').every((g) => g.held === null)).toBe(true);
    expect(gradeReview(null, 'A', 'well')).toEqual([]);
  });
});

describe('withOutcome', () => {
  it('answers the one review and leaves the other', () => {
    const next = withOutcome([review(), review({ at: 90 })], 30, 'well', [{ advisor: 'cfo', pick: 'A', held: true }], 'now');
    expect(next?.[0]).toMatchObject({ outcome: 'well', answeredAt: 'now' });
    expect(next?.[1].outcome).toBeNull();
    expect(withOutcome([review()], 90, 'well', [], 'now')).toBeNull();
  });
});

describe('pickScorecard', () => {
  it('counts each question once, by its latest answer, by topic', () => {
    const cards = pickScorecard([
      {
        topic: 'work',
        reviews: [
          review({ outcome: 'badly', grades: [{ advisor: 'mentor', pick: 'A', held: false }] }),
          review({ at: 90, outcome: 'well', grades: [{ advisor: 'mentor', pick: 'A', held: true }, { advisor: 'cfo', pick: 'B', held: false }] }),
        ],
      },
      {
        topic: 'money',
        reviews: [review({ outcome: 'well', grades: [{ advisor: 'mentor', pick: 'B', held: false }, { advisor: 'cfo', pick: null, held: null }] })],
      },
      { topic: null, reviews: [review({ outcome: 'well', grades: [{ advisor: 'cfo', pick: 'A', held: true }] })] },
      { topic: 'time', reviews: [review()] },
    ]);
    const mentor = cards.find((c) => c.advisor === 'mentor')!;
    expect(mentor).toMatchObject({ held: 1, graded: 2 });
    expect(topicsLine(mentor)).toBe('Work 1 of 1 · Money 0 of 1');
    const cfo = cards.find((c) => c.advisor === 'cfo')!;
    expect(cfo).toMatchObject({ held: 1, graded: 2 });
    expect(topicsLine(cfo)).toBe('Work 0 of 1 · Other 1 of 1');
  });
});

describe('check-backs that fell due before a meeting wrote them (plan #2581.10)', () => {
  const row = {
    id: 'q1',
    question: 'Take the contract?',
    options: [{ letter: 'A', text: 'Take it' }],
    decided_option: 'A',
    decided_at: '2026-09-01T10:00:00Z',
    success_measure: 'Two interviews by December.',
    topic: 'work',
    reviews: [],
  };

  it('lists a due check-back with no account, from its day on', () => {
    expect(dueUnwritten('2026-09-01T10:00:00Z', [], '2026-09-30')).toEqual([]);
    expect(dueUnwritten('2026-09-01T10:00:00Z', [], '2026-10-01')).toEqual([{ at: 30, due: '2026-10-01' }]);
    const [due] = decisionReviews(row, '2026-10-27');
    expect(due).toMatchObject({
      at: 30,
      account: '',
      option: 'A',
      due: '2026-10-01',
      successMeasure: 'Two interviews by December.',
    });
    expect(decisionReviews(row)).toEqual([]);
  });

  it('keeps an answered entry with no account', () => {
    const [entry] = reviewsOf([
      { at: 30, outcome: 'well', answered_at: 'x', scores: [{ advisor: 'cfo', probability: 0.7, brier: 0.09 }] },
    ]);
    expect(entry).toMatchObject({ account: '', scores: [{ advisor: 'cfo', probability: 0.7, brier: 0.09 }] });
  });

  it('asks from the success measure and labels the answers met or not', () => {
    expect(reviewAsk({ ask: '', successMeasure: 'Two interviews by December.' })).toBe(
      'You said you would know it went well if: Two interviews by December. Did it?',
    );
    expect(reviewAsk({ ask: 'Did it go well?', successMeasure: 'x' })).toBe('Did it go well?');
    expect(reviewAsk({ ask: '', successMeasure: null })).toBe('Did this decision go well?');
    expect(outcomeLabels({ successMeasure: 'x' }).well).toBe('Met it');
    expect(outcomeLabels({ successMeasure: null }).well).toBe('Went well');
  });

  it('lists only the latest unanswered check-back, and none before a later answer', () => {
    expect(openReviews([{ at: 30, outcome: null }, { at: 90, outcome: null }]).map((r) => r.at)).toEqual([90]);
    expect(openReviews([{ at: 30, outcome: null }, { at: 90, outcome: 'well' as const }])).toEqual([]);
    expect(openReviews([{ at: 30, outcome: 'well' as const }, { at: 90, outcome: null }]).map((r) => r.at)).toEqual([
      90,
    ]);
  });
});
