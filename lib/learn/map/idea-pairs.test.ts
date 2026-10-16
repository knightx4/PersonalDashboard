import { describe, expect, it } from 'vitest';
import {
  keepBothCarry,
  pairHref,
  similarityPercent,
  standingText,
  suggestedKeep,
  type IdeaPair,
  type PairIdea,
} from './idea-pairs';

function idea(id: string, rest: Partial<PairIdea> = {}): PairIdea {
  return {
    id,
    name: `Idea ${id}`,
    claim: 'A claim.',
    subject: { id: `s-${id}`, name: `Subject ${id}` },
    state: null,
    established: null,
    answers: 0,
    links: 0,
    ...rest,
  };
}

const pair = (a: PairIdea, b: PairIdea): IdeaPair => ({ a, b, similarity: 0.9 });

describe('pairHref', () => {
  it('puts the lower id first whichever way it is asked', () => {
    expect(pairHref('b', 'a')).toBe('/learn/space/pairs/a/b');
    expect(pairHref('a', 'b')).toBe('/learn/space/pairs/a/b');
  });
});

describe('suggestedKeep', () => {
  it('keeps the tested idea over one never answered', () => {
    const tested = idea('b', { state: 'known', established: 'tested' });
    expect(suggestedKeep(pair(idea('a', { links: 5 }), tested)).id).toBe('b');
  });

  it('then the one with more answers, then more links', () => {
    expect(suggestedKeep(pair(idea('a'), idea('b', { answers: 1 }))).id).toBe('b');
    expect(suggestedKeep(pair(idea('a', { links: 3 }), idea('b', { links: 1 }))).id).toBe('a');
  });

  it('prefers a name written as a sentence over an identifier', () => {
    const slug = idea('a', { name: 'cac_fully_loaded' });
    const sentence = idea('b', { name: 'CAC is a fully-loaded cost' });
    expect(suggestedKeep(pair(slug, sentence)).id).toBe('b');
  });

  it('falls back to the first', () => {
    expect(suggestedKeep(pair(idea('a'), idea('b'))).id).toBe('a');
  });
});

describe('keepBothCarry', () => {
  it('carries a tested result that holds the idea onto one with no state', () => {
    const known = idea('a', { state: 'known', established: 'tested' });
    const carry = keepBothCarry(pair(idea('b'), known));
    expect(carry?.from.id).toBe('a');
    expect(carry?.to.id).toBe('b');
    expect(carry?.state).toBe('known');
  });

  it('never carries a wrong answer, an inference or a declaration', () => {
    expect(keepBothCarry(pair(idea('a', { state: 'shaky', established: 'tested' }), idea('b')))).toBeNull();
    expect(keepBothCarry(pair(idea('a', { state: 'known', established: 'inferred' }), idea('b')))).toBeNull();
    expect(keepBothCarry(pair(idea('a', { state: 'known', established: 'declared' }), idea('b')))).toBeNull();
  });

  it('never overwrites a state the other idea already has', () => {
    const known = idea('a', { state: 'known', established: 'tested' });
    const shaky = idea('b', { state: 'shaky', established: 'tested' });
    expect(keepBothCarry(pair(known, shaky))).toBeNull();
  });
});

describe('words', () => {
  it('says the similarity as a percentage and the standing in words', () => {
    expect(similarityPercent(0.913)).toBe('91%');
    expect(standingText({ state: 'known', established: 'tested' })).toBe('Known, tested');
    expect(standingText({ state: null, established: null })).toBe('Not answered yet');
  });
});
