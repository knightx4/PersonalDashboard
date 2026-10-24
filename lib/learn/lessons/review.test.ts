import { describe, expect, it } from 'vitest';
import {
  addDays,
  firstReviewDays,
  heldInterval,
  isReviewable,
  nextDueLine,
  nextInterval,
  pickDue,
  spreadPieces,
  REVIEW_MAX_DAYS,
  REVIEW_STEPS as STEPS,
  reviewedState,
  reviewLines,
  reviewPrompt,
  reviewToday,
  toReviewQuestion,
} from './review';

describe('nextInterval', () => {
  it('climbs 1, 3, 7, 16, 35 on right answers, then doubles to the ceiling', () => {
    const gaps: number[] = [];
    let gap = 1;
    for (let i = 0; i < 8; i++) {
      gap = nextInterval(gap, true);
      gaps.push(gap);
    }
    expect(gaps).toEqual([3, 7, 16, 35, 70, 140, REVIEW_MAX_DAYS, REVIEW_MAX_DAYS]);
  });

  it('brings a missed idea back the next day, wherever it was', () => {
    expect(nextInterval(35, false)).toBe(1);
    expect(nextInterval(1, false)).toBe(1);
  });

  it('lands between steps on the next step up', () => {
    expect(nextInterval(5, true)).toBe(7);
  });

  it('starts from the first step with no gap to go on', () => {
    expect(nextInterval(null, true)).toBe(1);
  });
});

describe('the days', () => {
  it('reads today as the UTC date and counts days across a month end', () => {
    expect(reviewToday(new Date('2026-09-30T23:30:00Z'))).toBe('2026-09-30');
    expect(addDays('2026-09-30', 1)).toBe('2026-10-01');
    expect(addDays('2026-12-25', 16)).toBe('2027-01-10');
  });

  it('says when the idea comes back', () => {
    expect(nextDueLine(1)).toBe('It comes back tomorrow.');
    expect(nextDueLine(7)).toBe('It comes back in 7 days.');
  });
});

describe('reviewedState', () => {
  it('keeps sharp sharp and makes the rest known on a right answer', () => {
    expect(reviewedState('sharp', true)).toBe('sharp');
    expect(reviewedState('shaky', true)).toBe('known');
  });

  it('makes a missed idea shaky', () => {
    expect(reviewedState('sharp', false)).toBe('shaky');
  });
});

describe('reviewPrompt', () => {
  const idea = { trackName: 'SaaS metrics', pieceTitle: 'Churn', name: 'Churn compounds', claim: 'Each month loses a share.' };

  it('names the idea and the questions already asked', () => {
    const prompt = reviewPrompt(idea, ['Why does churn slow?', ' '], 'report_question');
    expect(prompt).toContain('The idea: Churn compounds');
    expect(prompt).toContain('- Why does churn slow?');
    expect(prompt).toContain('Call report_question.');
  });

  it('leaves the earlier list out when nothing was asked', () => {
    expect(reviewPrompt(idea, [], 't')).not.toContain('Already asked');
  });
});

describe('toReviewQuestion', () => {
  it('holds the expected answer back until the question is answered', () => {
    const row = {
      id: 'q',
      concept_id: 'c',
      question: 'Why?',
      expected: 'Because.',
      response: null,
      correct: null,
      marked_why: null,
    };
    expect(toReviewQuestion(row).expected).toBeNull();
    expect(toReviewQuestion({ ...row, response: 'x', correct: false, marked_why: 'No.' }).expected).toBe('Because.');
  });
});

describe('the first review', () => {
  it('brings a tested idea back the next day and a declared one in three', () => {
    expect(firstReviewDays('tested')).toBe(1);
    expect(firstReviewDays('declared')).toBe(3);
  });

  it('schedules what is held in some measure, and not what is unknown or mixed up', () => {
    for (const state of ['shaky', 'recognised', 'known', 'sharp'] as const) expect(isReviewable(state)).toBe(true);
    expect(isReviewable('unknown')).toBe(false);
    expect(isReviewable('misconception')).toBe(false);
    expect(isReviewable(null)).toBe(false);
  });
});

describe('reviewLines', () => {
  it('names the piece when one taught the idea, and leaves the line out when none did', () => {
    const idea = { trackName: 'SaaS metrics', pieceTitle: 'Churn', name: 'Churn compounds', claim: 'x' };
    expect(reviewLines(idea)).toContain('Piece it was learned in: Churn');
    expect(reviewLines({ ...idea, pieceTitle: null }).join('\n')).not.toContain('Piece it was learned in');
  });
});

describe('pickDue', () => {
  const pieces = [
    { id: 'p2', subjectId: 's1', title: 'Later', conceptIds: ['a', 'b'], passedAt: '2026-09-20T00:00:00Z' },
    { id: 'p1', subjectId: 's1', title: 'Earlier', conceptIds: ['a'], passedAt: '2026-09-10T00:00:00Z' },
    { id: 'p3', subjectId: 's2', title: 'Other plan', conceptIds: ['c'], passedAt: '2026-09-15T00:00:00Z' },
  ];
  const due = [
    { conceptId: 'c', dueOn: '2026-09-25', subjectId: 's2' },
    { conceptId: 'a', dueOn: '2026-09-26', subjectId: 's1' },
    { conceptId: 'b', dueOn: '2026-09-21', subjectId: 's1' },
    { conceptId: 'z', dueOn: '2026-09-01', subjectId: 's1' },
  ];

  it('orders the most overdue first, names the first piece that taught each, and keeps ideas no piece taught', () => {
    const picked = pickDue(due, pieces, { limit: 5 });
    expect(picked.map((entry) => [entry.conceptId, entry.piece?.id ?? null])).toEqual([
      ['z', null],
      ['b', 'p2'],
      ['c', 'p3'],
      ['a', 'p1'],
    ]);
  });

  it("keeps one track by the idea's own track, skips what the page teaches, and stops at the limit", () => {
    expect(pickDue(due, pieces, { limit: 5, subjectId: 's1' }).map((entry) => entry.conceptId)).toEqual(['z', 'b', 'a']);
    expect(pickDue(due, pieces, { limit: 5, subjectId: 's1', skip: new Set(['b']) }).map((e) => e.conceptId)).toEqual([
      'z',
      'a',
    ]);
    expect(pickDue(due, pieces, { limit: 1 })).toHaveLength(1);
  });

  it('shows due ideas when no piece has been passed at all', () => {
    expect(pickDue(due, [], { limit: 2 }).map((entry) => [entry.conceptId, entry.piece])).toEqual([
      ['z', null],
      ['b', null],
    ]);
  });
});

describe('mixing the due list (plan #2522.8)', () => {
  const pieces = [
    { id: 'p1', subjectId: 's1', title: 'One', conceptIds: ['a', 'b', 'c'], passedAt: '2026-09-10T00:00:00Z' },
    { id: 'p2', subjectId: 's2', title: 'Two', conceptIds: ['d'], passedAt: '2026-09-11T00:00:00Z' },
  ];

  it('never puts two ideas from one piece side by side while another piece has one due', () => {
    const due = [
      { conceptId: 'a', dueOn: '2026-09-01', subjectId: 's1' },
      { conceptId: 'b', dueOn: '2026-09-02', subjectId: 's1' },
      { conceptId: 'c', dueOn: '2026-09-03', subjectId: 's1' },
      { conceptId: 'd', dueOn: '2026-09-04', subjectId: 's2' },
    ];
    expect(pickDue(due, pieces, { limit: 5 }).map((e) => e.conceptId)).toEqual(['a', 'd', 'b', 'c']);
  });

  it('lets a piece follow itself only when nothing else is due', () => {
    const due = [
      { conceptId: 'a', dueOn: '2026-09-01', subjectId: 's1' },
      { conceptId: 'b', dueOn: '2026-09-02', subjectId: 's1' },
    ];
    expect(pickDue(due, pieces, { limit: 5 }).map((e) => e.conceptId)).toEqual(['a', 'b']);
  });

  it('does not treat ideas no piece taught as one piece', () => {
    const rows = [{ piece: null }, { piece: null }];
    expect(spreadPieces(rows)).toEqual(rows);
  });
});

describe('a right guess in review (plan #2522.3)', () => {
  it('keeps the gap the idea was on', () => {
    expect(heldInterval(7)).toBe(7);
    expect(heldInterval(null)).toBe(STEPS[0]);
    expect(heldInterval(0)).toBe(STEPS[0]);
  });
});
