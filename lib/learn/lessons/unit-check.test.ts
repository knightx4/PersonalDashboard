import { describe, expect, it } from 'vitest';
import type { TrackWeight } from '@/lib/learn/flow/interest';
import type { UnitGoal } from '@/lib/learn/graph/curriculum-view';
import type { Concept, Graph, KnowledgeState } from '@/lib/learn/graph/model';
import { toFeedCard, type FeedCardRow } from '@/lib/learn/feed/card';
import { chooseLessons, type LessonTrack } from './choose';
import { unitCheckDue, unitCheckWhy } from './unit-check';

/**
 * Which unit's check a track is due (plan #971): the latest done unit, once,
 * over the concepts that unit brought in, and none for a unit with nothing
 * known of its own.
 */

function concept(id: string, state: KnowledgeState): Concept {
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
    state,
    established: 'declared',
    misconception: null,
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

function goal(unitId: string, conceptId: string): UnitGoal {
  return { id: `goal-${unitId}`, asked: conceptId, conceptId, status: 'active', unitId };
}

/**
 * Two units over a > b > g1 and b > c > g2: unit 1's goal is g1, unit 2's is
 * g2. Unit 2 rests on b, which unit 1 already brought in.
 */
function track(states: Record<string, KnowledgeState>): LessonTrack {
  return {
    subjectId: 'econ',
    name: 'Economics',
    units: [{ id: 'u1' }, { id: 'u2' }],
    goals: [goal('u1', 'g1'), goal('u2', 'g2')],
    graph: graphOf(
      { a: 'unknown', b: 'unknown', g1: 'unknown', c: 'unknown', g2: 'unknown', ...states },
      ['a>b', 'b>g1', 'b>c', 'c>g2'],
    ),
  };
}

const UNIT_ONE_KNOWN = { a: 'known', b: 'known', g1: 'sharp' } as const;

describe('which unit check a track is due', () => {
  it('offers none while no unit is done', () => {
    expect(unitCheckDue(track({ a: 'known' }), new Set())).toBeNull();
  });

  it('offers the done unit, over its own concepts', () => {
    expect(unitCheckDue(track(UNIT_ONE_KNOWN), new Set())).toEqual({
      subjectId: 'econ',
      subjectName: 'Economics',
      unitId: 'u1',
      conceptIds: ['a', 'b', 'g1'],
    });
  });

  it('offers a unit once', () => {
    expect(unitCheckDue(track(UNIT_ONE_KNOWN), new Set(['u1']))).toBeNull();
  });

  it('offers only the latest done unit, less what an earlier unit brought in', () => {
    const due = unitCheckDue(track({ ...UNIT_ONE_KNOWN, c: 'known', g2: 'known' }), new Set());
    expect(due).toMatchObject({ unitId: 'u2', conceptIds: ['c', 'g2'] });
  });

  it('leaves out a concept that is not known, under a goal known on your word', () => {
    const due = unitCheckDue(track({ a: 'unknown', b: 'known', g1: 'known' }), new Set());
    expect(due).toMatchObject({ unitId: 'u1', conceptIds: ['b', 'g1'] });
  });

  it('comes out of the chooser, one per track, and not for a dormant track', () => {
    const weights = new Map<string, TrackWeight>([['econ', { weight: 1, stopped: false }]]);
    const choice = chooseLessons({ tracks: [track(UNIT_ONE_KNOWN)], weights, carded: new Set(), slots: 1 });
    expect(choice.checks.map((due) => due.unitId)).toEqual(['u1']);

    const stopped = new Map<string, TrackWeight>([['econ', { weight: 1, stopped: true }]]);
    const none = chooseLessons({ tracks: [track(UNIT_ONE_KNOWN)], weights: stopped, carded: new Set(), slots: 1 });
    expect(none.checks).toEqual([]);
  });
});

describe('a unit check on the deck', () => {
  const row: FeedCardRow = {
    id: 'card',
    reason: 'unit_check',
    status: 'ready',
    summary: 'You can say why prices move.',
    why: unitCheckWhy('Economics'),
    context: 'You can say why prices move.',
    hook: 'Why does a frost raise the price of oranges?',
    check_question: 'Why does a frost raise the price of oranges?',
    check_answer: 'Supply falls while demand holds, so the price rises.',
    item: null,
    segment: null,
    track_name: 'Economics',
    unit_title: 'Supply and demand',
    subject_id: 'econ',
  };

  it('is titled by the unit and carries the question but not the answer', () => {
    const card = toFeedCard(row);
    expect(card).toMatchObject({
      kind: 'check',
      title: 'Supply and demand',
      source: 'Economics',
      question: 'Why does a frost raise the price of oranges?',
      answer: null,
      link: null,
    });
    expect(card?.why).toBe('You finished this unit of your Economics track. One question on it, if you want it.');
  });

  it('is not shown without its question', () => {
    expect(toFeedCard({ ...row, check_question: null })).toBeNull();
  });
});
