import { describe, expect, it } from 'vitest';
import { BIG_FIVE_FACTORS } from './ipip';
import { shareOutThemes, traitEnd, traitSentences, TRAIT_SENTENCES } from './trait-themes';

const none = { extraversion: [], agreeableness: [], conscientiousness: [], emotional_stability: [], intellect: [] };

describe('traitEnd', () => {
  it('leans high from the middle of the range up', () => {
    expect(traitEnd(30)).toBe('high');
    expect(traitEnd(29)).toBe('low');
    expect(traitEnd(50)).toBe('high');
    expect(traitEnd(10)).toBe('low');
  });
});

describe('traitSentences', () => {
  it('picks the sentence for the end each score leans to', () => {
    const s = traitSentences({
      extraversion: 15,
      agreeableness: 40,
      conscientiousness: 30,
      emotional_stability: 20,
      intellect: 48,
    });
    expect(s.extraversion).toBe(TRAIT_SENTENCES.extraversion.low);
    expect(s.agreeableness).toBe(TRAIT_SENTENCES.agreeableness.high);
    expect(s.conscientiousness).toBe(TRAIT_SENTENCES.conscientiousness.high);
    expect(s.emotional_stability).toBe(TRAIT_SENTENCES.emotional_stability.low);
    expect(s.intellect).toBe(TRAIT_SENTENCES.intellect.high);
  });

  it('has a distinct sentence for every end', () => {
    const all = BIG_FIVE_FACTORS.flatMap((f) => [TRAIT_SENTENCES[f].high, TRAIT_SENTENCES[f].low]);
    expect(new Set(all).size).toBe(10);
  });
});

describe('shareOutThemes', () => {
  it('takes the closest three for each trait', () => {
    const out = shareOutThemes({
      ...none,
      intellect: [
        { id: 'a', name: 'Philosophy', similarity: 0.6 },
        { id: 'b', name: 'Art', similarity: 0.5 },
        { id: 'c', name: 'Reading', similarity: 0.4 },
        { id: 'd', name: 'Chess', similarity: 0.3 },
      ],
    });
    expect(out.intellect.map((t) => t.name)).toEqual(['Philosophy', 'Art', 'Reading']);
    expect(out.extraversion).toEqual([]);
  });

  it('shows a theme only under the trait it is closest to', () => {
    const out = shareOutThemes({
      ...none,
      extraversion: [
        { id: 'self', name: 'About me', similarity: 0.5 },
        { id: 'x', name: 'Parties', similarity: 0.45 },
      ],
      intellect: [
        { id: 'self', name: 'About me', similarity: 0.7 },
        { id: 'y', name: 'Jung', similarity: 0.4 },
      ],
    });
    expect(out.intellect.map((t) => t.id)).toEqual(['self', 'y']);
    expect(out.extraversion.map((t) => t.id)).toEqual(['x']);
  });

  it('breaks a tie by the order of the traits', () => {
    const out = shareOutThemes({
      ...none,
      extraversion: [{ id: 't', name: 'T', similarity: 0.5 }],
      agreeableness: [{ id: 't', name: 'T', similarity: 0.5 }],
    });
    expect(out.extraversion).toEqual([{ id: 't', name: 'T' }]);
    expect(out.agreeableness).toEqual([]);
  });
});
