import { describe, expect, it } from 'vitest';
import {
  isHeading,
  MIN_CLAIMS,
  normaliseClaims,
  normaliseClaims as normalise,
  openingPayloadSchema,
  TARGET_CLAIMS,
} from './opening-payload';

/**
 * What the ten claims have to be before a question is written against one.
 *
 * Each rule here is a way the list comes back looking right and measures
 * nothing: a heading cannot be answered from memory, the same claim twice
 * turns ten questions into nine, and a handful of claims is a sample of one
 * corner of a subject rather than a spread across it.
 */

function claim(name: string, text: string) {
  return { name, claim: text };
}

const REAL = claim(
  'Comparative advantage',
  'A country gains from trade even when it makes everything less efficiently, because what it gives up decides where it should specialise.',
);

function payload(claims: { name: string; claim: string }[]) {
  return openingPayloadSchema.parse({ subject: 'Economics', claims });
}

describe('a claim, not a heading', () => {
  it('keeps a sentence somebody can be wrong about', () => {
    expect(isHeading(REAL)).toBe(false);
    expect(normalise(payload([REAL]))).toEqual([REAL]);
  });

  it('drops a chapter title with a full stop on it', () => {
    expect(isHeading(claim('The Phillips curve', 'The Phillips curve.'))).toBe(true);
    expect(normalise(payload([claim('The Phillips curve', 'The Phillips curve.')]))).toEqual([]);
  });

  it('drops a claim that is the name back again', () => {
    // Long enough to pass the word count, and says nothing the name did not.
    const restated = claim(
      'The quantity theory of money',
      'The quantity theory of money, in the standard form.',
    );
    expect(isHeading(restated)).toBe(true);
  });

  it('drops one with no claim under it at all', () => {
    expect(normalise(payload([{ name: 'Sunk cost', claim: '' }]))).toEqual([]);
  });

  it('keeps the rest when one comes back as a heading', () => {
    const kept = normalise(payload([claim('Headline', 'Monetary policy.'), REAL]));
    expect(kept).toEqual([REAL]);
  });
});

describe('no two of them the same', () => {
  it('drops the second of two names for one idea', () => {
    const twice = normalise(
      payload([REAL, claim('Comparative Advantage', 'Something else entirely about trade gains.')]),
    );
    expect(twice).toHaveLength(1);
    expect(twice[0].name).toBe('Comparative advantage');
  });

  it('drops one sentence given two names', () => {
    const twice = normalise(payload([REAL, { ...REAL, name: 'Gains from trade' }]));
    expect(twice).toHaveLength(1);
  });

  it('ignores casing, punctuation and a leading article', () => {
    const same = claim(
      'the comparative advantage!',
      'A country gains from trade even when it makes everything less efficiently, because what it gives up decides where it should specialise.',
    );
    expect(normalise(payload([REAL, same]))).toHaveLength(1);
  });
});

describe('how many come back', () => {
  function spread(count: number) {
    return Array.from({ length: count }, (_, i) =>
      claim(`Claim ${i}`, `The ${i}th thing about this subject that somebody can be wrong about.`),
    );
  }

  it('takes ten and stops', () => {
    expect(normaliseClaims(payload(spread(14)))).toHaveLength(TARGET_CLAIMS);
  });

  it('leaves a thin list thin, for the caller to refuse', () => {
    // The floor is the call's to enforce, because what counts as too few
    // depends on whether anything was dropped on the way here.
    expect(normaliseClaims(payload(spread(3)))).toHaveLength(3);
    expect(MIN_CLAIMS).toBeLessThan(TARGET_CLAIMS);
  });
});
