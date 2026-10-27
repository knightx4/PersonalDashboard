import { describe, expect, it } from 'vitest';
import {
  advisorThinking,
  BRIEF_OPENING,
  debateFrom,
  decisionFromRow,
  exchanges,
  scoreGrid,
  scoresOf,
  verdictOf,
} from './board-debate';

const SK = 'adv-skeptic';
const MN = 'adv-mentor';
const WB = 'adv-buffett';
const Q1 = 'q1';
const Q2 = 'q2';

const advisors = [
  { id: WB, key: 'buffett', name: 'Warren Buffett', kind: 'guest', question: 'Twenty years?', focus: null, sources: [{ label: 'Letters', link: 'https://example.com' }, { label: '' }] },
  { id: SK, key: 'skeptic', name: 'Skeptic', kind: 'seat', question: 'Hours?' },
  { id: MN, key: 'mentor', name: 'Mentor', kind: 'seat', question: 'Ten years?' },
  { id: 'adv-unused', key: 'dimon', name: 'Jamie Dimon', kind: 'guest', question: 'Execution?' },
];

const questions = [
  { id: Q2, question: 'Second', options: [{ letter: 'A', text: 'x' }, { letter: 'B', text: 'y' }], status: 'discussing', created_at: '2026-10-01' },
  { id: Q1, question: 'First', options: [{ letter: 'A', text: 'x' }, { letter: 'B', text: 'y' }], status: 'discussing', created_at: '2026-10-02' },
  { id: 'bad', question: '', status: 'discussing' },
];

let n = 0;
const turn = (q: string, round: number, advisor: string, scores: unknown, to: string | null = null, text = 'Said.') => ({
  id: `t${n}`,
  question_id: q,
  round,
  advisor_id: advisor,
  addressed_to: to,
  kind: round === 1 ? 'opening' : round === 2 ? 'reply' : 'vote',
  text,
  scores,
  receipts: [],
  position: n++,
});

const turns = [
  turn(Q1, 1, SK, { A: 8, B: 3 }),
  turn(Q1, 1, MN, { A: 4, B: 7 }),
  turn(Q1, 1, WB, { A: 6, B: 6 }),
  turn(Q1, 2, SK, null, MN),
  turn(Q1, 2, MN, { A: 5, B: 7 }, SK),
  turn(Q1, 2, WB, null, SK),
  turn(Q1, 2, SK, null, MN),
  turn(Q1, 3, SK, { A: 8, B: 2 }),
  turn(Q1, 3, MN, { A: 6, B: 7 }),
  turn(Q1, 3, WB, { A: 7, B: 5 }),
  turn(Q1, 1, SK, { A: 'nine', B: 12 }, null, 'Bad scores.'),
  { id: 'broken', round: 4, advisor_id: SK, kind: 'vote', text: 'x' },
];

describe('scoresOf', () => {
  it('keeps single letters scored 1 to 10', () => {
    expect(scoresOf({ A: 7, B: '4', C: 0, D: 11, ab: 5 })).toEqual({ A: 7, B: 4 });
    expect(scoresOf({ A: 'x' })).toBeNull();
    expect(scoresOf(null)).toBeNull();
  });
});

describe('verdictOf', () => {
  it('reads the verdict the chair writes', () => {
    expect(
      verdictOf({
        recommended: 'A',
        conditions: ['One evening in writing', ''],
        dissent: [{ advisor: 'mentor', text: 'Three days.' }, { advisor: 'x' }],
        would_change: ['A full-time offer'],
        scores: [{ advisor: 'skeptic', scores: { A: 8, B: 2 } }, { advisor: 'mentor', scores: {} }],
      }),
    ).toEqual({
      recommended: 'A',
      conditions: ['One evening in writing'],
      dissent: [{ advisor: 'mentor', text: 'Three days.' }],
      wouldChange: ['A full-time offer'],
      scores: [{ advisor: 'skeptic', scores: { A: 8, B: 2 } }],
    });
  });
});

describe('debateFrom', () => {
  const debate = debateFrom(questions, turns, advisors, [Q1, Q2]);

  it('orders the questions by the agenda and drops a broken row', () => {
    expect(debate.questions.map((q) => q.id)).toEqual([Q1, Q2]);
  });

  it('keeps only the advisors who spoke, seats first', () => {
    expect(debate.advisors.map((a) => a.key)).toEqual(['mentor', 'skeptic', 'buffett']);
    expect(debate.advisors[2].sources).toEqual([{ label: 'Letters', link: 'https://example.com' }]);
  });

  it('drops a turn with no round it could have, and a score out of range', () => {
    const q1 = debate.questions[0];
    expect(q1.turns.some((t) => t.id === 'broken')).toBe(false);
    expect(q1.turns.find((t) => t.text === 'Bad scores.')?.scores).toBeNull();
  });

  it('orders by creation when there is no agenda', () => {
    expect(debateFrom(questions, [], advisors).questions.map((q) => q.id)).toEqual([Q2, Q1]);
  });
});

describe('scoreGrid', () => {
  const debate = debateFrom(questions, turns, advisors, [Q1, Q2]);
  const grid = scoreGrid(debate.questions[0], debate.advisors);

  it('gives each advisor their final score beside their round 1 score', () => {
    const mentor = grid.find((r) => r.advisor.id === MN)!;
    expect(mentor.cells.A).toEqual({ final: 6, first: 4 });
    expect(mentor.cells.B).toEqual({ final: 7, first: 7 });
    expect(mentor.backs).toBe('B');
  });

  it('backs nothing on a tie at the top', () => {
    const only = debateFrom(questions, turns.slice(2, 3), advisors, [Q1]);
    expect(scoreGrid(only.questions[0], only.advisors)[0].backs).toBeNull();
  });

  it('falls back to the verdict when no turn carries scores', () => {
    const withVerdict = debateFrom(
      [{ ...questions[1], verdict: { scores: [{ advisor: 'skeptic', scores: { A: 9, B: 1 } }] } }],
      [],
      advisors,
    );
    const rows = scoreGrid(withVerdict.questions[0], withVerdict.advisors);
    expect(rows.map((r) => [r.advisor.key, r.cells.A.final, r.cells.A.first])).toEqual([['skeptic', 9, null]]);
  });
});

describe('exchanges', () => {
  it('groups round 2 by the two advisors in it, in the order spoken', () => {
    const debate = debateFrom(questions, turns, advisors, [Q1]);
    const groups = exchanges(debate.questions[0]);
    expect(groups.map((g) => g.between)).toEqual([[SK, MN], [WB, SK]]);
    expect(groups[0].turns.map((t) => t.advisorId)).toEqual([SK, MN, SK]);
  });
});

describe('advisorThinking', () => {
  it('lists every turn an advisor wrote and how their scores moved', () => {
    const debate = debateFrom(questions, turns, advisors, [Q1]);
    const [mentor] = advisorThinking(debate, MN);
    expect(mentor.turns.map((t) => t.round)).toEqual([1, 2, 3]);
    expect(mentor.moves).toEqual([
      { round: 1, scores: { A: 4, B: 7 } },
      { round: 2, scores: { A: 5, B: 7 } },
      { round: 3, scores: { A: 6, B: 7 } },
    ]);
    expect(advisorThinking(debate, 'nobody')).toEqual([]);
  });
});

describe('BRIEF_OPENING', () => {
  it('finds the opening the skill writes for a brief', () => {
    expect(BRIEF_OPENING.test('Arguing for B, which nobody backed: Dreamer, Thursday is booked.')).toBe(true);
    expect(BRIEF_OPENING.test('Dreamer, arguing for B is fine.')).toBe(false);
  });
});

describe('decisionFromRow (plan #2561.6)', () => {
  it('reads what the person did from the status and decision columns', () => {
    expect(decisionFromRow({ status: 'discussing' })).toBeNull();
    expect(
      decisionFromRow({ status: 'decided', decided_option: 'B', decision_note: ' why ', decided_at: '2026-11-01T10:00:00Z' }),
    ).toEqual({ kind: 'option', option: 'B', note: 'why', decidedAt: '2026-11-01T10:00:00Z' });
    expect(decisionFromRow({ status: 'deferred', decision_note: null })?.kind).toBe('defer');
    expect(decisionFromRow({ status: 'dismissed' })?.kind).toBe('reject');
    expect(decisionFromRow({ status: 'decided', decided_option: null })).toBeNull();
  });
});
