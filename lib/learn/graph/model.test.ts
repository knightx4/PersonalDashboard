import { describe, expect, it } from 'vitest';
import {
  countStates,
  inferredFrom,
  learningOrder,
  pruneForGoal,
  readyNow,
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
    basis: 'Written by hand for this test.',
    state,
    established: 'inferred',
    misconception: state === 'misconception' ? `A wrong idea about ${id}.` : null,
    testedAt: null,
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

describe('how much of a subject is settled', () => {
  it('counts each state, and the total', () => {
    const graph = graphOf(
      { a: 'known', b: 'known', c: 'shaky', d: 'misconception', e: 'unknown' },
      [],
    );
    expect(countStates(graph)).toEqual({
      known: 2,
      shaky: 1,
      misconception: 1,
      unknown: 1,
      total: 5,
    });
  });

  it('is empty over an empty subject', () => {
    expect(countStates({ concepts: [], edges: [] })).toEqual({
      known: 0,
      shaky: 0,
      misconception: 0,
      unknown: 0,
      total: 0,
    });
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
