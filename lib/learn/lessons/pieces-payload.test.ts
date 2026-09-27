import { describe, expect, it } from 'vitest';
import type { UnitGoal } from '@/lib/learn/graph/curriculum-view';
import type { Concept, Graph } from '@/lib/learn/graph/model';
import { numberIdeas, piecesBounds, piecesPrompt, readPieces, unitIdeas } from './pieces-payload';

/**
 * Splitting a unit into pieces (plan #1140): which ideas are the unit's own,
 * how many pieces it gets, and how the model's grouping is read so that every
 * idea lands in exactly one piece.
 */

function concept(id: string): Concept {
  return {
    id,
    name: id,
    claim: `${id} is the case.`,
    claimOriginal: null,
    claimRewrittenAt: null,
    catalogueSearchedAt: null,
    basis: 'Written by hand for this test.',
    kind: null,
    mastery: [],
    state: 'unknown',
    established: 'declared',
    misconception: null,
    testedAt: null,
    declaredAt: null,
  };
}

/** "a>b" reads as: a is a prerequisite of b. */
function graphOf(ids: string[], edges: string[]): Graph {
  return {
    concepts: ids.map(concept),
    edges: edges.map((edge) => {
      const [prerequisiteId, dependentId] = edge.split('>');
      return { prerequisiteId, dependentId };
    }),
    mentions: [],
  };
}

function goal(unitId: string, conceptId: string, status = 'active'): UnitGoal {
  return { id: `goal-${unitId}`, asked: conceptId, conceptId, status, unitId };
}

/** Unit 1 over a > b > g1; unit 2 over b > c > g2, so b is unit 1's; unit 3 not laid out. */
const TRACK = {
  units: [{ id: 'u1' }, { id: 'u2' }, { id: 'u3' }],
  goals: [goal('u1', 'g1'), goal('u2', 'g2')],
  graph: graphOf(['a', 'b', 'g1', 'c', 'g2'], ['a>b', 'b>g1', 'b>c', 'c>g2']),
};

describe("a unit's own ideas", () => {
  it('are its goals and what they rest on, prerequisites first', () => {
    expect(unitIdeas(TRACK, 'u1').map((idea) => idea.id)).toEqual(['a', 'b', 'g1']);
  });

  it('leave out what an earlier unit already brought in', () => {
    expect(unitIdeas(TRACK, 'u2').map((idea) => idea.id)).toEqual(['c', 'g2']);
  });

  it('are none for a unit not laid out, or one whose only goal was abandoned', () => {
    expect(unitIdeas(TRACK, 'u3')).toEqual([]);
    expect(unitIdeas({ ...TRACK, goals: [goal('u1', 'g1', 'abandoned')] }, 'u1')).toEqual([]);
    expect(unitIdeas(TRACK, 'missing')).toEqual([]);
  });

  it('are numbered with what each builds on among them', () => {
    const ideas = unitIdeas(TRACK, 'u1');
    expect(numberIdeas(ideas, TRACK.graph).map((idea) => idea.buildsOn)).toEqual([[], [1], [2]]);
    // b is not among unit 2's ideas, so c builds on nothing listed.
    expect(numberIdeas(unitIdeas(TRACK, 'u2'), TRACK.graph).map((idea) => idea.buildsOn)).toEqual([[], [1]]);
  });
});

describe('how many pieces a unit gets', () => {
  it('is three to six, never more than it has ideas', () => {
    expect(piecesBounds(12)).toEqual({ min: 3, max: 6 });
    expect(piecesBounds(4)).toEqual({ min: 3, max: 4 });
    expect(piecesBounds(2)).toEqual({ min: 2, max: 2 });
  });

  it('is said in the prompt, with the ideas numbered', () => {
    const prompt = piecesPrompt({
      trackName: 'SaaS metrics',
      unit: { title: 'Retention', covers: 'Cohorts and churn.', outcome: 'Read a cohort grid.' },
      ideas: numberIdeas(unitIdeas(TRACK, 'u1'), TRACK.graph),
    });
    expect(prompt).toContain('The unit: Retention');
    expect(prompt).toContain('2. b: b is the case. (builds on 1)');
    expect(prompt).toContain('Split it into 3 pieces.');
  });
});

describe('reading the pieces', () => {
  it('keeps a clean grouping as given', () => {
    const result = readPieces(
      { pieces: [{ title: 'One', ideas: [1, 2] }, { title: 'Two', ideas: [3, 4] }, { title: 'Three', ideas: [5] }] },
      5,
    );
    expect(result).toEqual({
      ok: true,
      pieces: [
        { title: 'One', ideas: [1, 2] },
        { title: 'Two', ideas: [3, 4] },
        { title: 'Three', ideas: [5] },
      ],
    });
  });

  it('keeps a repeated idea in its first piece and ignores numbers off the list', () => {
    const result = readPieces(
      { pieces: [{ title: 'One', ideas: [1, 2, 9] }, { title: 'Two', ideas: [2, 3] }, { title: 'Three', ideas: [4, 0] }] },
      4,
    );
    expect(result).toEqual({
      ok: true,
      pieces: [
        { title: 'One', ideas: [1, 2] },
        { title: 'Two', ideas: [3] },
        { title: 'Three', ideas: [4] },
      ],
    });
  });

  it('puts an idea left out after the idea before it', () => {
    const result = readPieces(
      { pieces: [{ title: 'One', ideas: [2] }, { title: 'Two', ideas: [3, 5] }, { title: 'Three', ideas: [6] }] },
      6,
    );
    expect(result).toEqual({
      ok: true,
      pieces: [
        { title: 'One', ideas: [1, 2] },
        { title: 'Two', ideas: [3, 4, 5] },
        { title: 'Three', ideas: [6] },
      ],
    });
  });

  it('drops a piece with no title or no ideas, and fails outside the bounds', () => {
    expect(readPieces({ pieces: [{ title: ' ', ideas: [1] }, { title: 'All', ideas: [1, 2, 3, 4] }] }, 4)).toEqual({
      ok: false,
      detail: 'The unit came back in 1 piece.',
    });
    expect(readPieces({ pieces: [] }, 3).ok).toBe(false);
    expect(readPieces({ nope: true }, 3).ok).toBe(false);
  });
});
