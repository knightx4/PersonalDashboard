import { describe, expect, it } from 'vitest';
import {
  answeredCount,
  correctTotal,
  nextItemIndex,
  parseSet,
  scoreLine,
  scorePercent,
  type ExternalItem,
} from './model';

const item = (correct: boolean | null): ExternalItem => ({
  question: 'q',
  expected: 'a',
  response: correct === null ? null : 'x',
  correct,
});

describe('parseSet', () => {
  it('reads tab and bar separated lines and skips blanks', () => {
    const parsed = parseSet('What is ARR?\tAnnual recurring revenue\n\nWhat is NRR? | Net revenue retention');
    expect(parsed).toEqual({
      ok: true,
      items: [
        { question: 'What is ARR?', expected: 'Annual recurring revenue', response: null, correct: null },
        { question: 'What is NRR?', expected: 'Net revenue retention', response: null, correct: null },
      ],
    });
  });

  it('keeps a bar inside the answer', () => {
    const parsed = parseSet('Q | A | more');
    expect(parsed.ok && parsed.items[0]?.expected).toBe('A | more');
  });

  it('refuses a line with no separator, by number', () => {
    const parsed = parseSet('Q1\tA1\nQ2 with no answer');
    expect(parsed.ok).toBe(false);
    expect(!parsed.ok && parsed.error).toContain('Line 2');
  });

  it('refuses an empty paste and an oversized set', () => {
    expect(parseSet('  \n ').ok).toBe(false);
    const big = Array.from({ length: 101 }, (_, i) => `q${i}\ta`).join('\n');
    expect(parseSet(big).ok).toBe(false);
  });
});

describe('progress and score', () => {
  it('serves the first unanswered item and ends at null', () => {
    expect(nextItemIndex([item(true), item(null), item(null)])).toBe(1);
    expect(nextItemIndex([item(true), item(false)])).toBeNull();
  });

  it('counts answered and right', () => {
    const items = [item(true), item(false), item(null)];
    expect(answeredCount(items)).toBe(2);
    expect(correctTotal(items)).toBe(1);
  });

  it('says the score', () => {
    expect(scoreLine(21, 30)).toBe('21 of 30');
    expect(scorePercent(21, 30)).toBe(70);
    expect(scorePercent(0, 0)).toBe(0);
  });
});
