import { describe, expect, it } from 'vitest';
import {
  countStates,
  inferredFrom,
  isSettled,
  learningOrder,
  mentionsFor,
  pruneForGoal,
  readyNow,
  readyToLearn,
  settledCount,
  type Concept,
  type Graph,
  type KnowledgeState,
} from './model';

/**
 * The rule that decides what a person is actually shown.
 *
 * Tested harder than its size suggests, and before anything generates into the
 * graph, which is the whole point of building this slice first: a generated
 * graph plus an untested view rule gives you a screen that is wrong for two
 * reasons at once and no way to tell them apart.
 *
 * The case that matters most is the one in the spec's own words -- "how do I
 * not get shown thirty things I already know". Knowing one node has to prune
 * everything underneath it, and must not prune a node that still has an open
 * route to the goal.
 */

function concept(id: string, state: KnowledgeState = 'unknown'): Concept {
  return {
    id,
    name: id,
    claim: `${id} is the case, for a reason.`,
    claimOriginal: null,
    claimRewrittenAt: null,
    basis: 'Written by hand for this test.',
    kind: null,
    mastery: [],
    state,
    established: 'inferred',
    misconception: state === 'misconception' ? `A wrong idea about ${id}.` : null,
    testedAt: null,
  };
}

/** "a>b" reads as: a is a prerequisite of b; "a~b" as: a refers to b. */
function graphOf(
  states: Record<string, KnowledgeState>,
  edges: string[],
  mentions: string[] = [],
): Graph {
  return {
    concepts: Object.entries(states).map(([id, state]) => concept(id, state)),
    edges: edges.map((edge) => {
      const [prerequisiteId, dependentId] = edge.split('>');
      return { prerequisiteId, dependentId };
    }),
    mentions: mentions.map((mention) => {
      const [sourceId, targetId] = mention.split('~');
      return { sourceId, targetId, basis: `${sourceId} brings up ${targetId}.` };
    }),
  };
}

const names = (concepts: Concept[]) => concepts.map((c) => c.name);

describe('pruning a view of a goal', () => {
  it('keeps the chain leading to the goal', () => {
    const graph = graphOf({ a: 'unknown', b: 'unknown', c: 'unknown' }, ['a>b', 'b>c']);
    expect(pruneForGoal(graph, 'c').sort()).toEqual(['a', 'b', 'c']);
  });

  it('drops a node you already know', () => {
    const graph = graphOf({ a: 'known', b: 'unknown', c: 'unknown' }, ['a>b', 'b>c']);
    expect(pruneForGoal(graph, 'c').sort()).toEqual(['b', 'c']);
  });

  it('drops everything underneath a node you know', () => {
    // The spec's own question: how do I not get shown thirty things I already
    // know. Knowing `c` takes a, b and c out in one go.
    const graph = graphOf(
      { a: 'unknown', b: 'unknown', c: 'known', d: 'unknown', goal: 'unknown' },
      ['a>b', 'b>c', 'c>d', 'd>goal'],
    );
    expect(pruneForGoal(graph, 'goal').sort()).toEqual(['d', 'goal']);
  });

  it('keeps a node under something known when it has another open route', () => {
    // `low` sits under `known`, but it is also a prerequisite of `other`,
    // which is unsettled and on the way to the goal. Pruning it would hide
    // work that genuinely remains.
    const graph = graphOf(
      { low: 'unknown', settled: 'known', other: 'unknown', goal: 'unknown' },
      ['low>settled', 'settled>goal', 'low>other', 'other>goal'],
    );
    expect(pruneForGoal(graph, 'goal').sort()).toEqual(['goal', 'low', 'other']);
  });

  it('drops a node that leads nowhere near the goal', () => {
    const graph = graphOf(
      { a: 'unknown', goal: 'unknown', unrelated: 'unknown' },
      ['a>goal'],
    );
    expect(pruneForGoal(graph, 'goal').sort()).toEqual(['a', 'goal']);
  });

  it('keeps a shaky node, and a node carrying a misconception', () => {
    // Neither is a weak yes. A misconception is the strongest reason to show
    // a node there is: reading more will not fix it.
    const graph = graphOf({ a: 'shaky', b: 'misconception', goal: 'unknown' }, ['a>b', 'b>goal']);
    expect(pruneForGoal(graph, 'goal').sort()).toEqual(['a', 'b', 'goal']);
  });

  it('shows nothing for a goal you already know', () => {
    const graph = graphOf({ a: 'unknown', goal: 'known' }, ['a>goal']);
    expect(pruneForGoal(graph, 'goal')).toEqual([]);
  });

  it('shows nothing for a goal that is not in the graph', () => {
    expect(pruneForGoal(graphOf({ a: 'unknown' }, []), 'missing')).toEqual([]);
  });

  it('cuts a hundred nodes down to a handful', () => {
    // The claim the pruning rule exists to make good on: the store grows to
    // hundreds and the screen stays a dozen.
    const states: Record<string, KnowledgeState> = { goal: 'unknown', near: 'unknown' };
    const edges = ['near>goal'];
    for (let i = 0; i < 100; i += 1) {
      states[`old${i}`] = 'known';
      edges.push(`old${i}>near`);
    }

    const kept = pruneForGoal(graphOf(states, edges), 'goal');
    expect(kept.sort()).toEqual(['goal', 'near']);
  });
});

describe('the order to learn them in', () => {
  it('puts a prerequisite before what depends on it', () => {
    const graph = graphOf({ a: 'unknown', b: 'unknown', c: 'unknown' }, ['a>b', 'b>c']);
    expect(names(learningOrder(graph, ['c', 'a', 'b']))).toEqual(['a', 'b', 'c']);
  });

  it('breaks ties by name, so the same graph always renders the same way', () => {
    const graph = graphOf({ zebra: 'unknown', apple: 'unknown', goal: 'unknown' }, [
      'zebra>goal',
      'apple>goal',
    ]);
    expect(names(learningOrder(graph, ['goal', 'zebra', 'apple']))).toEqual([
      'apple',
      'zebra',
      'goal',
    ]);
  });

  it('ignores a prerequisite that is not in the view', () => {
    // Pruning removed it deliberately. Counting it would leave the whole view
    // waiting on a node nobody is going to learn.
    const graph = graphOf({ known: 'known', b: 'unknown' }, ['known>b']);
    expect(names(learningOrder(graph, ['b']))).toEqual(['b']);
  });

  it('shows every node it was given, even in a graph that should be impossible', () => {
    // The database refuses cycles. If one ever arrived anyway, a node missing
    // from the screen is worse than one in the wrong place.
    const graph = graphOf({ a: 'unknown', b: 'unknown' }, ['a>b', 'b>a']);
    expect(names(learningOrder(graph, ['a', 'b'])).sort()).toEqual(['a', 'b']);
  });
});

describe('what could be started now', () => {
  it('is the nodes with nothing unsettled underneath them', () => {
    const graph = graphOf({ a: 'unknown', b: 'unknown', c: 'unknown' }, ['a>b', 'b>c']);
    const kept = pruneForGoal(graph, 'c');
    expect(names(readyNow(graph, kept))).toEqual(['a']);
  });

  it('counts a settled prerequisite as no obstacle', () => {
    const graph = graphOf({ a: 'known', b: 'unknown', c: 'unknown' }, ['a>b', 'b>c']);
    const kept = pruneForGoal(graph, 'c');
    expect(names(readyNow(graph, kept))).toEqual(['b']);
  });

  it('can be more than one thing', () => {
    const graph = graphOf({ a: 'unknown', b: 'unknown', goal: 'unknown' }, ['a>goal', 'b>goal']);
    expect(names(readyNow(graph, pruneForGoal(graph, 'goal')))).toEqual(['a', 'b']);
  });
});

describe('what could be started anywhere in a subject', () => {
  it('is a node with nothing underneath it', () => {
    const graph = graphOf({ a: 'unknown', b: 'unknown' }, ['a>b']);
    expect(names(readyToLearn(graph))).toEqual(['a']);
  });

  it('holds back whatever rests on a shaky prerequisite', () => {
    // The difference from readyNow: nothing was pruned away here, so a
    // prerequisite somebody half-knows is an obstacle rather than an absence.
    const graph = graphOf({ a: 'shaky', b: 'unknown' }, ['a>b']);
    expect(names(readyToLearn(graph))).toEqual(['a']);
  });

  it('lets it through once that prerequisite is known', () => {
    const graph = graphOf({ a: 'known', b: 'unknown' }, ['a>b']);
    expect(names(readyToLearn(graph))).toEqual(['b']);
  });

  it('returns nothing when every node is known', () => {
    const graph = graphOf({ a: 'known', b: 'known' }, ['a>b']);
    expect(readyToLearn(graph)).toEqual([]);
  });

  it('finds something whenever anything is unsettled', () => {
    const graph = graphOf({ a: 'known', b: 'misconception', c: 'unknown', d: 'shaky' }, [
      'a>b',
      'b>c',
      'c>d',
    ]);
    expect(names(readyToLearn(graph))).toEqual(['b']);
  });
});

describe('one claim referring to another', () => {
  /**
   * The rule a second relation lives or dies by: nothing that walks the graph
   * may read it. A mention is a way across the graph sideways, from the claim
   * you are reading to one it talks about, and never a claim about what has to
   * be learned first.
   *
   * Asserted by giving the walks a graph carrying mentions and comparing it to
   * the same graph without them -- including a pair that refers to each other
   * both ways, which is the cycle every walk here assumes it will never meet.
   * If a mention is ever folded into `prerequisiteMap`, these fail.
   */
  const STATES: Record<string, KnowledgeState> = {
    a: 'unknown',
    b: 'unknown',
    c: 'unknown',
    d: 'unknown',
  };
  const EDGES = ['a>b', 'b>c'];
  const MENTIONS = ['c~a', 'a~c', 'd~b'];

  const bare = graphOf(STATES, EDGES);
  const withMentions = graphOf(STATES, EDGES, MENTIONS);

  it('does not change what a goal prunes to', () => {
    expect(pruneForGoal(withMentions, 'c').sort()).toEqual(pruneForGoal(bare, 'c').sort());
    // d refers to b and is still outside the goal's view, because referring to
    // something is not a route to it.
    expect(pruneForGoal(withMentions, 'c').sort()).toEqual(['a', 'b', 'c']);
  });

  it('does not change the order they would be learned in', () => {
    const ids = ['a', 'b', 'c', 'd'];
    expect(learningOrder(withMentions, ids).map((row) => row.id)).toEqual(
      learningOrder(bare, ids).map((row) => row.id),
    );
  });

  it('does not change what could be started now', () => {
    const ids = ['a', 'b', 'c', 'd'];
    expect(readyNow(withMentions, ids).map((row) => row.id)).toEqual(
      readyNow(bare, ids).map((row) => row.id),
    );
    // d has no prerequisite and mentioning b does not give it one.
    expect(readyNow(withMentions, ids).map((row) => row.id)).toEqual(['a', 'd']);
  });

  it('reads both directions, and carries why each link is there', () => {
    const { refersTo, referredToBy } = mentionsFor(withMentions, 'c');

    expect(refersTo.map((row) => row.concept.id)).toEqual(['a']);
    expect(refersTo[0].basis).toBe('c brings up a.');
    expect(referredToBy.map((row) => row.concept.id)).toEqual(['a']);
  });

  it('gives a concept nobody mentions two empty lists', () => {
    expect(mentionsFor(withMentions, 'b')).toEqual({
      refersTo: [],
      referredToBy: [{ concept: concept('d', 'unknown'), basis: 'd brings up b.' }],
    });
    expect(mentionsFor(bare, 'b')).toEqual({ refersTo: [], referredToBy: [] });
  });

  it('skips a mention naming something outside the graph', () => {
    // The same rule the prerequisite walk follows: a missing end is skipped
    // rather than invented, because a phantom node breaks a page invisibly.
    const graph = graphOf({ a: 'unknown' }, [], ['a~ghost']);
    expect(mentionsFor(graph, 'a').refersTo).toEqual([]);
  });
});

describe('how much of a subject is settled', () => {
  it('counts each state, and the total', () => {
    const graph = graphOf(
      { a: 'known', b: 'known', c: 'shaky', d: 'misconception', e: 'unknown', f: 'recognised' },
      [],
    );
    expect(countStates(graph)).toEqual({
      known: 2,
      shaky: 1,
      recognised: 1,
      sharp: 0,
      misconception: 1,
      unknown: 1,
      total: 6,
    });
  });

  it('is empty over an empty subject', () => {
    expect(countStates({ concepts: [], edges: [], mentions: [] })).toEqual({
      known: 0,
      shaky: 0,
      recognised: 0,
      sharp: 0,
      misconception: 0,
      unknown: 0,
      total: 0,
    });
  });

  it('counts a defended claim as settled and a recognised one as not', () => {
    const graph = graphOf({ a: 'known', b: 'sharp', c: 'recognised' }, []);
    expect(settledCount(countStates(graph))).toBe(2);
  });
});

describe('what counts as settled', () => {
  it('is known or sharp, and nothing else', () => {
    expect(isSettled(concept('a', 'known'))).toBe(true);
    expect(isSettled(concept('a', 'sharp'))).toBe(true);
    expect(isSettled(concept('a', 'recognised'))).toBe(false);
    expect(isSettled(concept('a', 'shaky'))).toBe(false);
    expect(isSettled(concept('a', 'unknown'))).toBe(false);
    expect(isSettled(concept('a', 'misconception'))).toBe(false);
  });

  it('keeps a recognised claim in the view, because its case is still to come', () => {
    // #392: picking the idea out of four is not using it, so the claim stays
    // where you can see it rather than being pruned the way known is.
    const graph = graphOf({ a: 'recognised', goal: 'unknown' }, ['a>goal']);
    expect(pruneForGoal(graph, 'goal').sort()).toEqual(['a', 'goal']);

    const settled = graphOf({ a: 'known', goal: 'unknown' }, ['a>goal']);
    expect(pruneForGoal(settled, 'goal')).toEqual(['goal']);
  });
});

describe('what a correct answer implies about what is underneath', () => {
  function withBasis(graph: Graph, ids: Record<string, 'tested' | 'inferred' | 'declared'>): Graph {
    return {
      ...graph,
      concepts: graph.concepts.map((concept) =>
        ids[concept.id] ? { ...concept, established: ids[concept.id] } : concept,
      ),
    };
  }

  it('marks everything beneath the node answered', () => {
    const graph = graphOf({ a: 'unknown', b: 'unknown', c: 'unknown' }, ['a>b', 'b>c']);
    expect(inferredFrom(graph, 'c').sort()).toEqual(['a', 'b']);
  });

  it('says nothing about the node itself', () => {
    const graph = graphOf({ a: 'unknown', b: 'unknown' }, ['a>b']);
    expect(inferredFrom(graph, 'b')).not.toContain('b');
  });

  it('leaves a node somebody has actually answered about alone', () => {
    // An inference must never overwrite evidence -- least of all on the node
    // they got wrong, which is exactly the one it would be wrong about.
    const graph = withBasis(graphOf({ a: 'shaky', b: 'unknown', c: 'unknown' }, ['a>b', 'b>c']), {
      a: 'tested',
    });
    expect(inferredFrom(graph, 'c')).toEqual(['b']);
  });

  it('still reaches what is under a tested node', () => {
    const graph = withBasis(
      graphOf({ floor: 'unknown', middle: 'known', top: 'unknown' }, ['floor>middle', 'middle>top']),
      { middle: 'tested' },
    );
    expect(inferredFrom(graph, 'top')).toEqual(['floor']);
  });

  it('counts a node once when two paths reach it', () => {
    const graph = graphOf(
      { base: 'unknown', left: 'unknown', right: 'unknown', top: 'unknown' },
      ['base>left', 'base>right', 'left>top', 'right>top'],
    );
    expect(inferredFrom(graph, 'top').sort()).toEqual(['base', 'left', 'right']);
  });

  it('implies nothing from a node with nothing under it', () => {
    expect(inferredFrom(graphOf({ a: 'unknown' }, []), 'a')).toEqual([]);
  });
});
