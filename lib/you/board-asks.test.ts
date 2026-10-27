import { describe, expect, it } from 'vitest';
import { answerError, askShown, asksOf, asksToJson, withAnswer, ASK_ANSWER_MAX } from './board-asks';

const raw = [
  { id: 'a1', text: ' What is the budget? ', asked_in: ['m1'], answer: null, answered_at: null, read_in: null },
  { id: 'a2', text: 'By when?', asked_in: ['m1', 'm2'], answer: 'March', answered_at: '2026-11-02T10:00:00Z', read_in: 'm3' },
  { id: 'a1', text: 'duplicate id', asked_in: [] },
  { id: 'a3', text: '' },
  'junk',
];

describe('asksOf', () => {
  it('keeps well-formed entries and drops the rest', () => {
    const asks = asksOf(raw);
    expect(asks.map((a) => a.id)).toEqual(['a1', 'a2']);
    expect(asks[0]).toMatchObject({ text: 'What is the budget?', answer: null, readIn: null });
    expect(asks[1]).toMatchObject({ answer: 'March', readIn: 'm3', askedIn: ['m1', 'm2'] });
  });
  it('reads a non-array as none', () => {
    expect(asksOf(null)).toEqual([]);
    expect(asksOf({})).toEqual([]);
  });
  it('round-trips through the table shape', () => {
    expect(asksOf(asksToJson(asksOf(raw)))).toEqual(asksOf(raw));
  });
});

describe('askShown', () => {
  it('shows unanswered and answered-but-unread, hides read answers', () => {
    const [a1, a2] = asksOf(raw);
    expect(askShown(a1)).toBe(true);
    expect(askShown(a2)).toBe(false);
    expect(askShown({ ...a2, readIn: null })).toBe(true);
  });
});

describe('withAnswer', () => {
  const asks = asksOf(raw);
  it('saves an answer and clears the read mark', () => {
    const next = withAnswer(asks, 'a2', ' April ', '2026-11-03T00:00:00Z')!;
    expect(next[1]).toMatchObject({ answer: 'April', answeredAt: '2026-11-03T00:00:00Z', readIn: null });
    expect(next[0]).toEqual(asks[0]);
  });
  it('takes the answer off when blank', () => {
    expect(withAnswer(asks, 'a2', '  ', 'x')![1]).toMatchObject({ answer: null, answeredAt: null });
  });
  it('is null for an unknown ask', () => {
    expect(withAnswer(asks, 'zz', 'x', 'x')).toBeNull();
  });
});

describe('answerError', () => {
  it('limits the length', () => {
    expect(answerError('x'.repeat(ASK_ANSWER_MAX))).toBeNull();
    expect(answerError('x'.repeat(ASK_ANSWER_MAX + 1))).toMatch(/2,000/);
  });
});
