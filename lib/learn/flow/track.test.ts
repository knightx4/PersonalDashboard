import { describe, expect, it } from 'vitest';
import type { Concept, Graph, KnowledgeState } from '@/lib/learn/graph/model';
import { trackChange, trackMove, trackPercent } from './track';

/**
 * The track line Practice Flow shows after an answer. What matters is that it
 * falls as readily as it rises, and that it counts `sharp` as settled the way
 * the subject page does.
 */

function graphOf(states: KnowledgeState[]): Graph {
  return {
    concepts: states.map(
      (state, index): Concept => ({
        id: `c${index}`,
        name: `c${index}`,
        claim: 'A claim.',
        claimOriginal: null,
        claimRewrittenAt: null,
        catalogueSearchedAt: null,
        basis: 'Written for this test.',
        kind: null,
        mastery: [],
        state,
        established: 'tested',
        misconception: null,
        testedAt: null,
        declaredAt: null,
      }),
    ),
    edges: [],
    mentions: [],
  };
}

describe('trackMove', () => {
  it('counts known and sharp as settled on both sides of the answer', () => {
    const move = trackMove(
      graphOf(['known', 'unknown', 'unknown']),
      graphOf(['known', 'sharp', 'unknown']),
    );
    expect(move).toEqual({ before: 1, settled: 2, total: 3 });
  });

  it('falls when a wrong answer makes a settled idea shaky', () => {
    const move = trackMove(graphOf(['known', 'known']), graphOf(['known', 'shaky']));
    expect(move.settled).toBeLessThan(move.before);
  });
});

describe('trackChange', () => {
  it('says what moved and from where', () => {
    expect(trackChange({ before: 6, settled: 7, total: 19 })).toBe('1 more idea known, up from 6.');
    expect(trackChange({ before: 6, settled: 9, total: 19 })).toBe('3 more ideas known, up from 6.');
    expect(trackChange({ before: 8, settled: 7, total: 19 })).toBe(
      '1 idea no longer known, down from 8.',
    );
    expect(trackChange({ before: 7, settled: 7, total: 19 })).toBe('Still 7 of 19 known.');
  });
});

describe('trackPercent', () => {
  it('draws an empty track as an empty bar', () => {
    expect(trackPercent(0, 0)).toBe(0);
    expect(trackPercent(7, 19)).toBe(37);
    expect(trackPercent(19, 19)).toBe(100);
  });
});
