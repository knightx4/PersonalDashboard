import { describe, expect, it } from 'vitest';
import { isRooted, MAX_SETTLED, rootingFor } from './rooting';
import type { Concept, Graph, KnowledgeState } from './model';

/**
 * What the search is told about you, and when there is nothing to tell.
 *
 * The two lists decide whether a suggestion is worth anything, and the second
 * question is the one that keeps it honest: a graph with nothing settled roots
 * nothing, and the difference between "rooted in four things you know" and
 * "not rooted in anything" has to be visible from here or the screen cannot
 * say which one happened.
 */

function concept(id: string, state: KnowledgeState = 'unknown'): Concept {
  return {
    id,
    name: id,
    claim: `${id} is the case, for a reason.`,
    claimOriginal: null,
    claimRewrittenAt: null,
    catalogueSearchedAt: null,
    basis: 'Written by hand for this test.',
    kind: null,
    mastery: [],
    state,
    established: 'inferred',
    misconception: state === 'misconception' ? `A wrong idea about ${id}.` : null,
    testedAt: null,
    declaredAt: null,
  };
}

/** "a>b" reads as: a is a prerequisite of b. */
function graphOf(states: Record<string, KnowledgeState>, edges: string[]): Graph {
  return {
    concepts: Object.entries(states).map(([id, state]) => concept(id, state)),
    edges: edges.map((edge) => {
      const [prerequisiteId, dependentId] = edge.split('>');
      return { prerequisiteId, dependentId };
    }),
    mentions: [],
  };
}

describe('what may be assumed', () => {
  it('is the settled claims and nothing else', () => {
    const graph = graphOf({ a: 'known', b: 'shaky', c: 'misconception' }, ['a>b', 'b>c']);
    expect(rootingFor(graph, null).settled).toEqual([concept('a').claim]);
  });

  it('leaves out shaky, which is a no with evidence rather than a weak yes', () => {
    const graph = graphOf({ a: 'shaky' }, []);
    expect(rootingFor(graph, null).settled).toEqual([]);
  });

  it('caps a long list and says how many it left out', () => {
    const states: Record<string, KnowledgeState> = {};
    for (let i = 0; i < MAX_SETTLED + 5; i += 1) states[`c${i}`] = 'known';

    const rooting = rootingFor(graphOf(states, []), null);
    expect(rooting.settled).toHaveLength(MAX_SETTLED);
    expect(rooting.settledOmitted).toBe(5);
  });
});

describe('where you are', () => {
  it('is the unsettled claims with nothing unsettled underneath them', () => {
    const graph = graphOf({ a: 'unknown', b: 'unknown', c: 'unknown' }, ['a>b', 'b>c']);
    expect(rootingFor(graph, null).frontier).toEqual([concept('a').claim]);
  });

  it('moves up past what you already know', () => {
    // Knowing the floor is what makes the thing above it startable, which is
    // the whole promise: never bored by the basics.
    const graph = graphOf({ a: 'known', b: 'unknown', c: 'unknown' }, ['a>b', 'b>c']);
    expect(rootingFor(graph, null).frontier).toEqual([concept('b').claim]);
  });

  it('leaves out the claim the reading is already aimed at', () => {
    const graph = graphOf({ a: 'shaky', b: 'unknown' }, ['a>b']);
    expect(rootingFor(graph, 'a').frontier).toEqual([]);
  });
});

describe('whether it is rooted at all', () => {
  it('is not, when the graph has nothing settled in it', () => {
    const graph = graphOf({ a: 'unknown', b: 'shaky' }, ['a>b']);
    expect(isRooted(rootingFor(graph, null))).toBe(false);
  });

  it('is not, on an empty graph', () => {
    expect(isRooted(rootingFor({ concepts: [], edges: [], mentions: [] }, null))).toBe(false);
  });

  it('is, as soon as one claim is settled', () => {
    const graph = graphOf({ a: 'known', b: 'unknown' }, ['a>b']);
    expect(isRooted(rootingFor(graph, null))).toBe(true);
  });
});
