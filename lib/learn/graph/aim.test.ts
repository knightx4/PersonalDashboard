import { describe, expect, it } from 'vitest';
import { aimFor, aimSentence } from './aim';
import type { Concept } from './model';

/**
 * What a search is told the reading is for.
 *
 * Small enough to look obvious, and worth pinning anyway: this is the one
 * place the claim is read off a concept, and the thing that goes wrong is the
 * misconception being dropped. A search told "explain marginal cost" and a
 * search told "explain marginal cost to somebody who thinks it means average
 * cost" come back with different reading lists, and only the second one is
 * worth an evening.
 */

const concept = (over: Partial<Concept> = {}): Concept => ({
  id: 'c1',
  name: 'Marginal cost',
  claim: 'Marginal cost is the cost of one more unit, not the average per unit.',
  claimOriginal: null,
  claimRewrittenAt: null,
  basis: 'Named in the brief.',
  kind: 'threshold',
  state: 'shaky',
  established: 'tested',
  misconception: null,
  mastery: [],
  testedAt: null,
  declaredAt: null,
  ...over,
});

describe('reading the aim off a concept', () => {
  it('takes the claim and the state, not the short name', () => {
    const aim = aimFor(concept());
    expect(aim.claim).toContain('one more unit');
    expect(aim.state).toBe('shaky');
    expect(aim.misconception).toBeNull();
  });

  it('carries the wrong belief when there is one', () => {
    const aim = aimFor(
      concept({ state: 'misconception', misconception: 'That it means the average per unit.' }),
    );
    expect(aim.state).toBe('misconception');
    expect(aim.misconception).toBe('That it means the average per unit.');
  });
});

describe('the aim as a sentence', () => {
  it('is the claim alone when nothing is believed instead', () => {
    expect(aimSentence(aimFor(concept()))).toBe(concept().claim);
  });

  it('names the wrong belief after the claim', () => {
    const sentence = aimSentence(
      aimFor(concept({ state: 'misconception', misconception: 'That it means the average.' })),
    );
    expect(sentence).toContain('one more unit');
    expect(sentence).toContain('believed instead: That it means the average.');
  });
});
