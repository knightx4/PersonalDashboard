import { describe, expect, it } from 'vitest';
import {
  BIG_FIVE_FACTORS,
  IPIP_ITEMS,
  factorPercent,
  isCompleteAnswers,
  scoreBigFive,
} from './ipip';

describe('the IPIP 50-item key', () => {
  it('has ten items a factor, cycling E A C ES I', () => {
    expect(IPIP_ITEMS).toHaveLength(50);
    for (const factor of BIG_FIVE_FACTORS) {
      expect(IPIP_ITEMS.filter((i) => i.factor === factor)).toHaveLength(10);
    }
    expect(IPIP_ITEMS[0]).toMatchObject({ number: 1, factor: 'extraversion', keyed: 'plus' });
    expect(IPIP_ITEMS[3]).toMatchObject({ factor: 'emotional_stability', keyed: 'minus' });
    expect(IPIP_ITEMS[49]).toMatchObject({ number: 50, factor: 'intellect', keyed: 'plus' });
  });

  it('keys each factor as the IPIP does', () => {
    const minus = (factor: string) =>
      IPIP_ITEMS.filter((i) => i.factor === factor && i.keyed === 'minus').map((i) => i.number);
    expect(minus('extraversion')).toEqual([6, 16, 26, 36, 46]);
    expect(minus('agreeableness')).toEqual([2, 12, 22, 32]);
    expect(minus('conscientiousness')).toEqual([8, 18, 28, 38]);
    expect(minus('emotional_stability')).toEqual([4, 14, 24, 29, 34, 39, 44, 49]);
    expect(minus('intellect')).toEqual([10, 20, 30]);
  });
});

describe('scoreBigFive', () => {
  it('scores all "neither" as the middle of every range', () => {
    expect(scoreBigFive(Array(50).fill(3))).toEqual({
      extraversion: 30,
      agreeableness: 30,
      conscientiousness: 30,
      emotional_stability: 30,
      intellect: 30,
    });
  });

  it('scores all "very accurate" by the count of plus- and minus-keyed items', () => {
    expect(scoreBigFive(Array(50).fill(5))).toEqual({
      extraversion: 30,
      agreeableness: 34,
      conscientiousness: 34,
      emotional_stability: 18,
      intellect: 38,
    });
  });

  it('reaches the top of every range when each item is answered toward its key', () => {
    const answers = IPIP_ITEMS.map((i) => (i.keyed === 'plus' ? 5 : 1));
    for (const score of Object.values(scoreBigFive(answers))) expect(score).toBe(50);
  });

  it('refuses an incomplete or out-of-range set', () => {
    expect(() => scoreBigFive(Array(49).fill(3))).toThrow();
    expect(isCompleteAnswers([...Array(49).fill(3), 6])).toBe(false);
    expect(isCompleteAnswers([...Array(49).fill(3), 2.5])).toBe(false);
  });
});

describe('factorPercent', () => {
  it('maps 10 to 50 onto 0 to 100', () => {
    expect(factorPercent(10)).toBe(0);
    expect(factorPercent(30)).toBe(50);
    expect(factorPercent(50)).toBe(100);
  });
});
