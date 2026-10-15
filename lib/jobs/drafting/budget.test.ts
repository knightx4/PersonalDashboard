import { describe, expect, it } from 'vitest';
import { CUT_MARK, cutOptional, cutText, fitToBudget } from './budget';

describe('cutText', () => {
  it('leaves a short text alone, trimmed', () => {
    expect(cutText('  short one  ', 50)).toBe('short one');
  });

  it('cuts at a word, marks the cut and stays within the budget', () => {
    const text = 'alpha beta gamma delta epsilon zeta eta theta iota kappa';
    const cut = cutText(text, 30);
    expect(cut.length).toBeLessThanOrEqual(30);
    expect(cut.endsWith(CUT_MARK)).toBe(true);
    const kept = cut.slice(0, -CUT_MARK.length);
    expect(text.startsWith(kept)).toBe(true);
    expect(text[kept.length]).toBe(' ');
  });

  it('cuts mid-word when there is no break worth keeping', () => {
    expect(cutText('x'.repeat(100), 20)).toBe(`${'x'.repeat(20 - CUT_MARK.length)}${CUT_MARK}`);
  });
});

describe('cutOptional', () => {
  it('is null for nothing', () => {
    expect(cutOptional(null, 10)).toBeNull();
    expect(cutOptional('   ', 10)).toBeNull();
    expect(cutOptional('hi', 10)).toBe('hi');
  });
});

describe('fitToBudget', () => {
  it('keeps items in order until the next would not fit, and counts the rest', () => {
    const { kept, omitted } = fitToBudget(['aaaa', 'bbbb', 'cc', 'd'], (s) => s.length, 9);
    expect(kept).toEqual(['aaaa', 'bbbb']);
    expect(omitted).toBe(2);
  });

  it('keeps everything that fits', () => {
    expect(fitToBudget([1, 2, 3], () => 1, 10)).toEqual({ kept: [1, 2, 3], omitted: 0 });
  });
});
