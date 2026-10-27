import { describe, expect, it } from 'vitest';
import {
  backLink,
  clipTitle,
  dateIn,
  madeRefsOf,
  makeCandidates,
  MAKE_TITLE_MAX,
  stillToMake,
} from './board-make';

const options = [
  { letter: 'A', text: 'Take the contract, full time, from 16 November' },
  { letter: 'B', text: 'Keep the search full time' },
];
const verdict = {
  recommended: 'A',
  conditions: ['Get one evening written in by 2026-11-13.', 'Keep two applications a week.'],
  dissent: [],
  assumptions: [],
  wouldChange: [],
  scores: [],
};
const decided = (option: string) => ({
  kind: 'option' as const,
  option,
  note: null,
  decidedAt: null,
});

describe('dateIn', () => {
  it('reads an ISO date, a day-first and a month-first date', () => {
    expect(dateIn('by 2026-11-13', '2026-11-02')).toBe('2026-11-13');
    expect(dateIn('from 16 November', '2026-11-02')).toBe('2026-11-16');
    expect(dateIn('on Nov 5th', '2026-11-02')).toBe('2026-11-05');
    expect(dateIn('on 3 Dec 2027', '2026-11-02')).toBe('2027-12-03');
  });

  it('rolls a date with no year to the next one', () => {
    expect(dateIn('by 1 March', '2026-11-02')).toBe('2027-03-01');
  });

  it('gives nothing for a month word with no day, or no date at all', () => {
    expect(dateIn('you may do it', '2026-11-02')).toBeNull();
    expect(dateIn('before you sign', '2026-11-02')).toBeNull();
    expect(dateIn('on 31 February', '2026-11-02')).toBeNull();
  });
});

describe('makeCandidates', () => {
  it('offers the action and the conditions when the board was followed', () => {
    const got = makeCandidates({ options, verdict, decision: decided('A') }, '2026-11-02');
    expect(got.map((c) => [c.key, c.dueOn])).toEqual([
      ['action', '2026-11-16'],
      ['condition-0', '2026-11-13'],
      ['condition-1', null],
    ]);
  });

  it('offers only the action when another option was decided', () => {
    const got = makeCandidates({ options, verdict, decision: decided('B') }, '2026-11-02');
    expect(got.map((c) => c.key)).toEqual(['action']);
  });

  it('offers nothing for a question put off or turned down', () => {
    const put = { kind: 'defer' as const, option: null, note: null, decidedAt: null };
    expect(makeCandidates({ options, verdict, decision: put }, '2026-11-02')).toEqual([]);
    expect(makeCandidates({ options, verdict, decision: null }, '2026-11-02')).toEqual([]);
  });

  it('leaves out what is already made', () => {
    const all = makeCandidates({ options, verdict, decision: decided('A') }, '2026-11-02');
    expect(stillToMake(all, [{ key: 'action' }]).map((c) => c.key)).toEqual([
      'condition-0',
      'condition-1',
    ]);
  });
});

describe('the rest', () => {
  it('keeps a title under the limit', () => {
    expect(clipTitle('x'.repeat(900))).toHaveLength(MAKE_TITLE_MAX);
    expect(clipTitle('  two   words ')).toBe('two words');
  });

  it('reads stored refs defensively', () => {
    expect(
      madeRefsOf([
        { kind: 'todo', id: 'a', key: 'action' },
        { kind: 'x', id: 'b', key: 'k' },
        null,
      ]),
    ).toEqual([{ kind: 'todo', id: 'a', key: 'action' }]);
    expect(madeRefsOf('nope')).toEqual([]);
  });

  it('links back to the question in its meeting', () => {
    const q = { id: 'q1', question: 'Take it?', options };
    expect(backLink(q, 'm1', 'A')).toBe(
      "From the board's decision on [Take it?](/you/board/m1#board-q-q1) (option A).",
    );
    expect(backLink(q, null, null)).toContain('(/you/board)');
  });
});
