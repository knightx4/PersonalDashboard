import { describe, expect, it } from 'vitest';
import {
  gradeReview,
  nextReview,
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
