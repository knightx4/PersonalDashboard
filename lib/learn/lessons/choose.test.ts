import { describe, expect, it } from 'vitest';
import type { TrackWeight } from '@/lib/learn/flow/interest';
import type { UnitGoal } from '@/lib/learn/graph/curriculum-view';
import type { Concept, Graph, KnowledgeState } from '@/lib/learn/graph/model';
import { chooseLessons, planTrack, type LessonTrack } from './choose';

/**
 * The lesson chooser against tracks written by hand (plan #975): slots shared
 * by weight, dormant tracks left out, and inside a track the ready concepts of
 * the first unit that is not done, less any already on a card.
 */

function concept(id: string, state: KnowledgeState): Concept {
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
    misconception: null,
    testedAt: null,
    declaredAt: null,
  };
}

/** "a>b" reads as: a is a prerequisite of b. */
function graphOf(states: Record<string, KnowledgeState>, edges: string[] = []): Graph {
  return {
    concepts: Object.entries(states).map(([id, state]) => concept(id, state)),
    edges: edges.map((edge) => {
      const [prerequisiteId, dependentId] = edge.split('>');
      return { prerequisiteId, dependentId };
    }),
    mentions: [],
  };
}

function goal(unitId: string, conceptId: string | null): UnitGoal {
  return { id: `goal-${unitId}-${conceptId}`, asked: conceptId ?? '?', conceptId, status: 'active', unitId };
}

/**
 * A track with one unit whose goal is `top`, over a chain a > b > top with
 * nothing known: only `a` is ready.
 */
function chainTrack(id: string, extra: Record<string, KnowledgeState> = {}): LessonTrack {
  return {
    subjectId: id,
    name: id.toUpperCase(),
    units: [{ id: `${id}-u1` }],
    goals: [goal(`${id}-u1`, `${id}-top`)],
    graph: graphOf(
      { [`${id}-a`]: 'unknown', [`${id}-b`]: 'unknown', [`${id}-top`]: 'unknown', ...extra },
      [`${id}-a>${id}-b`, `${id}-b>${id}-top`],
    ),
  };
}

/** A track whose unit has `count` ready concepts, none depending on another. */
function wideTrack(id: string, count: number): LessonTrack {
  const states: Record<string, KnowledgeState> = { [`${id}-top`]: 'unknown' };
  const edges: string[] = [];
  for (let i = 0; i < count; i += 1) {
    states[`${id}-${i}`] = 'unknown';
    edges.push(`${id}-${i}>${id}-top`);
  }
  return {
    subjectId: id,
    name: id,
    units: [{ id: `${id}-u1` }],
    goals: [goal(`${id}-u1`, `${id}-top`)],
    graph: graphOf(states, edges),
  };
}

const weight = (value: number, stopped = false): TrackWeight => ({ weight: value, stopped });

describe('planTrack', () => {
  it('teaches the concept whose prerequisites are known, in the first unit not done', () => {
    const track: LessonTrack = {
      subjectId: 's',
      name: 'S',
      units: [{ id: 'u1' }, { id: 'u2' }],
      goals: [goal('u1', 'one'), goal('u2', 'two')],
      graph: graphOf(
        { base: 'known', one: 'known', mid: 'unknown', two: 'unknown', far: 'unknown' },
        ['base>mid', 'mid>two', 'far>two'],
      ),
    };
    const plan = planTrack(track, new Set());
    expect(plan.kind).toBe('teach');
    if (plan.kind !== 'teach') return;
    expect(plan.candidates.map((pick) => pick.concept.id).sort()).toEqual(['far', 'mid']);
    expect(plan.candidates.every((pick) => pick.unitId === 'u2')).toBe(true);
  });

  it('leaves out concepts off the path to the unit goals', () => {
    const track = chainTrack('s', { 's-stray': 'unknown' });
    const plan = planTrack(track, new Set());
    expect(plan.kind === 'teach' && plan.candidates.map((pick) => pick.concept.id)).toEqual(['s-a']);
  });

  it('skips known concepts and ones whose prerequisites are not known', () => {
    const track = chainTrack('s', { 's-a': 'known' });
    const plan = planTrack(track, new Set());
    expect(plan.kind === 'teach' && plan.candidates.map((pick) => pick.concept.id)).toEqual(['s-b']);
  });

  it('puts the concept nearest the unit goal first', () => {
    const track: LessonTrack = {
      subjectId: 's',
      name: 'S',
      units: [{ id: 'u1' }],
      goals: [goal('u1', 'top')],
      graph: graphOf({ deep: 'unknown', near: 'unknown', mid: 'unknown', top: 'unknown' }, [
        'deep>mid',
        'mid>top',
        'near>top',
      ]),
    };
    const plan = planTrack(track, new Set());
    expect(plan.kind === 'teach' && plan.candidates.map((pick) => pick.concept.id)).toEqual([
      'near',
      'deep',
    ]);
  });

  it('skips a concept already on a card, and waits when every ready one is', () => {
    const track = wideTrack('s', 2);
    const one = planTrack(track, new Set(['s-0']));
    expect(one.kind === 'teach' && one.candidates.map((pick) => pick.concept.id)).toEqual(['s-1']);
    expect(planTrack(track, new Set(['s-0', 's-1']))).toEqual({ kind: 'waiting' });
  });

  it('asks for the chain of a unit with no goal yet, naming the unit', () => {
    const track: LessonTrack = {
      subjectId: 's',
      name: 'S',
      units: [{ id: 'u1' }, { id: 'u2' }],
      goals: [goal('u1', 'one'), goal('u2', null)],
      graph: graphOf({ one: 'known' }),
    };
    expect(planTrack(track, new Set())).toEqual({
      kind: 'need',
      need: { subjectId: 's', subjectName: 'S', because: 'no-chain', unitId: 'u2' },
    });
  });

  it('asks for a new unit after the last when every unit is done', () => {
    const track: LessonTrack = {
      subjectId: 's',
      name: 'S',
      units: [{ id: 'u1' }, { id: 'u2' }],
      goals: [goal('u1', 'one'), goal('u2', 'two')],
      graph: graphOf({ one: 'known', two: 'sharp' }),
    };
    expect(planTrack(track, new Set())).toEqual({
      kind: 'need',
      need: { subjectId: 's', subjectName: 'S', because: 'all-units-done', unitId: 'u2' },
    });
  });

  it('asks for a first unit when the track has no curriculum', () => {
    const track: LessonTrack = {
      subjectId: 's',
      name: 'S',
      units: [],
      goals: [],
      graph: graphOf({ loose: 'unknown' }),
    };
    expect(planTrack(track, new Set())).toEqual({
      kind: 'need',
      need: { subjectId: 's', subjectName: 'S', because: 'no-curriculum', unitId: null },
    });
  });
});

describe('chooseLessons', () => {
  it('spreads slots by weight', () => {
    const choice = chooseLessons({
      tracks: [wideTrack('heavy', 10), wideTrack('light', 10)],
      weights: new Map([
        ['heavy', weight(3)],
        ['light', weight(1)],
      ]),
      carded: new Set(),
      slots: 8,
    });
    const count = (id: string) => choice.picks.filter((pick) => pick.subjectId === id).length;
    expect(choice.picks).toHaveLength(8);
    expect(count('heavy')).toBe(6);
    expect(count('light')).toBe(2);
  });

  it('counts cards already dealt towards a track share', () => {
    const choice = chooseLessons({
      tracks: [wideTrack('a', 5), wideTrack('b', 5)],
      weights: new Map(),
      carded: new Set(),
      dealt: new Map([['a', 3]]),
      slots: 3,
    });
    expect(choice.picks.map((pick) => pick.subjectId)).toEqual(['b', 'b', 'b']);
  });

  it('never picks a concept twice, and leaves slots empty once tracks run out', () => {
    const choice = chooseLessons({
      tracks: [wideTrack('a', 2), chainTrack('b')],
      weights: new Map(),
      carded: new Set(),
      slots: 10,
    });
    const ids = choice.picks.map((pick) => pick.concept.id);
    expect(ids.sort()).toEqual(['a-0', 'a-1', 'b-a']);
  });

  it('leaves out dormant tracks and reports them', () => {
    const choice = chooseLessons({
      tracks: [wideTrack('used', 3), wideTrack('stopped', 3)],
      weights: new Map([
        ['used', weight(1)],
        ['stopped', weight(0.5, true)],
      ]),
      carded: new Set(),
      slots: 3,
    });
    expect(choice.picks.every((pick) => pick.subjectId === 'used')).toBe(true);
    expect(choice.dormant).toEqual(['stopped']);
    expect(choice.needs).toEqual([]);
  });

  it('reports needs and waiting tracks beside the picks', () => {
    const noChain: LessonTrack = {
      subjectId: 'fresh',
      name: 'Fresh',
      units: [{ id: 'fresh-u1' }],
      goals: [],
      graph: graphOf({}),
    };
    const choice = chooseLessons({
      tracks: [chainTrack('a'), noChain, wideTrack('full', 1)],
      weights: new Map(),
      carded: new Set(['full-0']),
      slots: 2,
    });
    expect(choice.picks.map((pick) => pick.concept.id)).toEqual(['a-a']);
    expect(choice.needs).toEqual([
      { subjectId: 'fresh', subjectName: 'Fresh', because: 'no-chain', unitId: 'fresh-u1' },
    ]);
    expect(choice.waiting).toEqual(['full']);
  });
});
