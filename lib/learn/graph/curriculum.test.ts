import { describe, expect, it } from 'vitest';
import { MAX_UNITS, readCurriculum, unitGoal } from './curriculum-payload';
import { curriculumRows, type UnitGoal } from './curriculum-view';
import type { Concept, Graph, KnowledgeState } from './model';

/**
 * A track's fixed curriculum: reading what the model reported, and how the
 * units read on the track page once some of them have been opened.
 */

function unit(n: number) {
  return {
    title: `Unit ${n}`,
    covers: `What unit ${n} covers.`,
    outcome: `Do the thing from unit ${n}.`,
  };
}

describe('reading the curriculum', () => {
  it('keeps the units in order and maps the goal unit onto them', () => {
    const result = readCurriculum({ units: [1, 2, 3, 4, 5, 6, 7].map(unit), goal_unit: 3 });
    expect(result).toMatchObject({ ok: true, goalUnit: 2 });
    if (result.ok)
      expect(result.units.map((u) => u.title)).toEqual(
        [1, 2, 3, 4, 5, 6, 7].map((n) => `Unit ${n}`),
      );
  });

  it('leaves out incomplete and repeated units, and moves the goal unit with them', () => {
    const units = [
      unit(1),
      { ...unit(2), covers: ' ' },
      unit(3),
      { ...unit(3) },
      ...[4, 5, 6, 7].map(unit),
    ];
    const result = readCurriculum({ units, goal_unit: 5 });
    // Unit 2 and the repeat of unit 3 are gone; the model's fifth is Unit 4, now third.
    expect(result).toMatchObject({ ok: true, goalUnit: 2 });
    if (result.ok) expect(result.units).toHaveLength(6);
  });

  it('drops the goal unit when it pointed at a unit that was left out', () => {
    const units = [unit(1), { ...unit(2), title: '' }, ...[3, 4, 5, 6, 7].map(unit)];
    expect(readCurriculum({ units, goal_unit: 2 })).toMatchObject({ ok: true, goalUnit: null });
  });

  it('cuts a curriculum past the most units, and refuses one too short to be a course', () => {
    const long = readCurriculum({
      units: Array.from({ length: 20 }, (_, i) => unit(i + 1)),
      goal_unit: null,
    });
    if (long.ok) expect(long.units).toHaveLength(MAX_UNITS);
    expect(readCurriculum({ units: [1, 2, 3].map(unit), goal_unit: 1 })).toMatchObject({
      ok: false,
    });
    expect(readCurriculum({ units: 'many' })).toMatchObject({ ok: false });
  });

  it('asks a unit for its title and outcome when it is opened', () => {
    expect(unitGoal(unit(4))).toBe('Unit 4: Do the thing from unit 4.');
  });
});

function concept(id: string, state: KnowledgeState): Concept {
  return {
    id,
    name: id,
    claim: `${id} holds.`,
    claimOriginal: null,
    claimRewrittenAt: null,
    catalogueSearchedAt: null,
    basis: 'Test.',
    kind: null,
    mastery: [],
    state,
    established: 'inferred',
    misconception: null,
    testedAt: null,
    declaredAt: null,
  };
}

describe('the curriculum on the track page', () => {
  const graph: Graph = {
    concepts: [
      concept('a', 'known'),
      concept('b', 'known'),
      concept('c', 'unknown'),
      concept('d', 'unknown'),
    ],
    edges: [
      { prerequisiteId: 'a', dependentId: 'b' },
      { prerequisiteId: 'c', dependentId: 'd' },
    ],
    mentions: [],
  };
  const units = [{ id: 'u1' }, { id: 'u2' }, { id: 'u3' }];
  const goal = (
    id: string,
    conceptId: string | null,
    unitId: string | null,
    status = 'active',
  ): UnitGoal => ({
    id,
    asked: id,
    conceptId,
    unitId,
    status,
  });

  it('marks each unit by its goals, and the first unfinished one as next', () => {
    const { rows } = curriculumRows(units, [goal('g1', 'b', 'u1'), goal('g2', 'd', 'u2')], graph);
    expect(rows.map((row) => [row.state, row.left, row.next])).toEqual([
      ['done', 0, false],
      ['in-progress', 2, true],
      ['not-opened', 0, false],
    ]);
  });

  it('keeps goals asked outside the curriculum apart, and ignores abandoned ones', () => {
    const { rows, outside } = curriculumRows(
      units,
      [goal('g1', 'd', null), goal('g2', 'd', 'gone'), goal('g3', 'b', 'u1', 'abandoned')],
      graph,
    );
    expect(outside.map((g) => g.id)).toEqual(['g1', 'g2']);
    expect(rows[0]).toMatchObject({ state: 'not-opened', next: true });
  });
});
