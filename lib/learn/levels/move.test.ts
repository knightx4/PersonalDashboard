import { describe, expect, it } from 'vitest';
import type { MapTopic } from '@/lib/learn/levels/draft-payload';
import {
  edgeOutcome,
  evidenceFromState,
  lensTargets,
  moveCounts,
  readAssignment,
  type ConceptState,
} from '@/lib/learn/levels/move';

const MAP: MapTopic[] = [
  { id: 't-dcf', name: 'Discounted cash flow', scope: 'Valuing a company by its cash flows.', ceiling: 10, approved: true },
  { id: 't-ret', name: 'Return', scope: 'What a return is.', ceiling: 4, approved: true },
];

const CONCEPTS = [
  { id: 'c1', name: 'Present value', claim: 'Money later is worth less now.' },
  { id: 'c2', name: 'Holding return', claim: 'Return is gain over cost.' },
  { id: 'c3', name: 'Beta', claim: 'Beta measures co-movement with the market.' },
  { id: 'c4', name: 'Orphan', claim: 'Placed nowhere.' },
];

describe('readAssignment', () => {
  const result = readAssignment(
    {
      placements: [
        { concept: 1, topic: 'discounted cash flow', level: 2 },
        { concept: 2, topic: 'Return', level: 7 },
        { concept: 3, topic: 'Beta', level: 3, unsure: '  could be CAPM  ' },
        { concept: 1, topic: 'Return', level: 1 },
        { concept: 9, topic: 'Return', level: 1 },
        { concept: 4, topic: 'Nowhere', level: 1 },
      ],
      new_topics: [
        { name: 'Beta', scope: 'How a stock moves with the market.' },
        { name: 'Return', scope: 'Duplicate of the map.' },
        { name: 'Unused', scope: 'Nothing lands here.' },
      ],
    },
    CONCEPTS,
    MAP,
  );

  it('matches map topics by name, ignoring case', () => {
    expect(result.placements[0]).toMatchObject({ conceptId: 'c1', topicId: 't-dcf', topicName: 'Discounted cash flow', level: 2, unsure: null });
  });

  it('clamps to the ceiling and says so', () => {
    expect(result.placements[1]).toMatchObject({ conceptId: 'c2', topicId: 't-ret', level: 4 });
    expect(result.placements[1].unsure).toContain('above where Return stops');
  });

  it('puts a concept on a new topic only when the topic is listed, and keeps the doubt', () => {
    expect(result.placements[2]).toMatchObject({ conceptId: 'c3', topicId: null, topicName: 'Beta', unsure: 'could be CAPM' });
    expect(result.newTopics).toEqual([{ name: 'Beta', scope: 'How a stock moves with the market.' }]);
  });

  it('keeps the first placement and lists what landed nowhere', () => {
    expect(result.placements.filter((p) => p.conceptId === 'c1')).toHaveLength(1);
    expect(result.unplaced).toEqual(['c4']);
  });
});

describe('evidenceFromState', () => {
  const state = (s: string, established: string): ConceptState => ({
    state: s,
    established,
    testedAt: '2026-10-01T00:00:00Z',
    declaredAt: '2026-10-02T00:00:00Z',
    updatedAt: '2026-10-03T00:00:00Z',
  });

  it('writes met for known and sharp, tested', () => {
    expect(evidenceFromState(state('known', 'tested'), 6)).toEqual({ verdict: 'met', observedAt: '2026-10-01T00:00:00Z' });
    expect(evidenceFromState(state('sharp', 'tested'), 9)?.verdict).toBe('met');
  });

  it('writes met for recognised only at levels 1 and 2', () => {
    expect(evidenceFromState(state('recognised', 'tested'), 2)?.verdict).toBe('met');
    expect(evidenceFromState(state('recognised', 'tested'), 3)).toBeNull();
  });

  it('writes not met for shaky and misconception, whatever the basis', () => {
    expect(evidenceFromState(state('shaky', 'tested'), 5)?.verdict).toBe('not_met');
    expect(evidenceFromState(state('shaky', 'declared'), 5)?.verdict).toBe('not_met');
    expect(evidenceFromState(state('misconception', 'tested'), 1)?.verdict).toBe('not_met');
  });

  it('writes declared for a declared state, dated when it was declared', () => {
    expect(evidenceFromState(state('known', 'declared'), 7)).toEqual({ verdict: 'declared', observedAt: '2026-10-02T00:00:00Z' });
  });

  it('writes nothing for inferred or unknown', () => {
    expect(evidenceFromState(state('known', 'inferred'), 3)).toBeNull();
    expect(evidenceFromState(state('unknown', 'tested'), 3)).toBeNull();
  });
});

describe('edgeOutcome', () => {
  it('links across topics', () => {
    expect(edgeOutcome({ topicId: 'a', level: 5 }, { topicId: 'b', level: 1 })).toEqual({ kind: 'link' });
  });

  it('leaves an upward or level edge inside one topic to the chain', () => {
    expect(edgeOutcome({ topicId: 'a', level: 2 }, { topicId: 'a', level: 4 })).toEqual({ kind: 'chain' });
    expect(edgeOutcome({ topicId: 'a', level: 3 }, { topicId: 'a', level: 3 })).toEqual({ kind: 'chain' });
  });

  it('sends a downward edge inside one topic to the person', () => {
    expect(edgeOutcome({ topicId: 'a', level: 5 }, { topicId: 'a', level: 2 })).toEqual({ kind: 'review' });
  });

  it('skips an edge with an end that was not placed', () => {
    expect(edgeOutcome(undefined, { topicId: 'a', level: 2 })).toEqual({ kind: 'unplaced' });
  });
});

describe('lensTargets and moveCounts', () => {
  it('targets the highest level any concept reached on each topic', () => {
    expect(
      lensTargets([
        { topicId: 'a', level: 2 },
        { topicId: 'a', level: 6 },
        { topicId: 'b', level: 1 },
      ]),
    ).toEqual(
      new Map([
        ['a', 6],
        ['b', 1],
      ]),
    );
  });

  it('counts subjects by how their move went', () => {
    expect(
      moveCounts([
        { subjectId: '1', subjectName: 'A', status: 'moved', detail: null },
        { subjectId: '2', subjectName: 'B', status: 'failed', detail: 'x' },
        { subjectId: '3', subjectName: 'C', status: 'waiting', detail: null },
        { subjectId: '4', subjectName: 'D', status: 'waiting', detail: null },
      ]),
    ).toEqual({ moved: 1, failed: 1, waiting: 2 });
  });
});
