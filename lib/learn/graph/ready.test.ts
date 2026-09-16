import { describe, expect, it } from 'vitest';
import { READY_LIMIT, rankReady, readyInSubject, stepsToGoal, type ReadyConcept } from './ready';
import type { Concept, Graph, KnowledgeState } from './model';

/**
 * The order one screen shows for every subject at once.
 *
 * The rule underneath it is tested in model.test.ts; what is tested here is
 * what plan #298 settled -- distance to a goal you named decides, state breaks
 * the tie, and eight rows is the screen.
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

const subject = { id: 'subject-1', name: 'Optics' };
const names = (rows: ReadyConcept[]) => rows.map((row) => row.concept.name);

function row(name: string, stepsToGoal: number | null, state: KnowledgeState = 'unknown') {
  return {
    concept: concept(name, state),
    subjectId: subject.id,
    subjectName: subject.name,
    stepsToGoal,
  };
}

describe('how far a concept is from a goal', () => {
  it('counts the edges up to it', () => {
    const graph = graphOf({ a: 'unknown', b: 'unknown', goal: 'unknown' }, ['a>b', 'b>goal']);
    const steps = stepsToGoal(graph, ['goal']);
    expect([steps.get('goal'), steps.get('b'), steps.get('a')]).toEqual([0, 1, 2]);
  });

  it('keeps the shorter route when two goals reach the same concept', () => {
    const graph = graphOf({ a: 'unknown', b: 'unknown', near: 'unknown', far: 'unknown' }, [
      'a>near',
      'a>b',
      'b>far',
    ]);
    expect(stepsToGoal(graph, ['near', 'far']).get('a')).toBe(1);
  });

  it('gives no number to a concept with no goal above it', () => {
    const graph = graphOf({ a: 'unknown', goal: 'unknown' }, []);
    expect(stepsToGoal(graph, ['goal']).has('a')).toBe(false);
  });
});

describe('what is ready in one subject', () => {
  it('carries the subject and the distance on every row', () => {
    const graph = graphOf({ a: 'known', b: 'unknown', goal: 'unknown' }, ['a>b', 'b>goal']);
    const rows = readyInSubject(graph, subject, ['goal']);
    expect(rows).toEqual([
      {
        concept: expect.objectContaining({ name: 'b' }),
        subjectId: 'subject-1',
        subjectName: 'Optics',
        stepsToGoal: 1,
      },
    ]);
  });

  it('still lists a concept in a subject with no goals', () => {
    const graph = graphOf({ a: 'unknown' }, []);
    expect(readyInSubject(graph, subject, [])).toEqual([
      expect.objectContaining({ stepsToGoal: null }),
    ]);
  });
});

describe('the order the screen shows', () => {
  it('puts the concept closest to a goal first', () => {
    expect(names(rankReady([row('far', 4), row('near', 1), row('middle', 2)]))).toEqual([
      'near',
      'middle',
      'far',
    ]);
  });

  it('puts everything with a goal above it before everything without', () => {
    expect(names(rankReady([row('adrift', null, 'misconception'), row('aimed', 9)]))).toEqual([
      'aimed',
      'adrift',
    ]);
  });

  it('breaks a tie on the worse state', () => {
    const rows = [row('c', 2), row('a', 2, 'shaky'), row('b', 2, 'misconception')];
    expect(names(rankReady(rows))).toEqual(['b', 'a', 'c']);
  });

  it('breaks a tie on state by name', () => {
    expect(names(rankReady([row('zebra', 2), row('apple', 2)]))).toEqual(['apple', 'zebra']);
  });

  it('shows eight and no more', () => {
    const rows = Array.from({ length: 12 }, (_, index) => row(`c${index}`, index));
    const ranked = rankReady(rows);
    expect(ranked).toHaveLength(READY_LIMIT);
    expect(names(ranked)).toEqual(['c0', 'c1', 'c2', 'c3', 'c4', 'c5', 'c6', 'c7']);
  });
});
