import { describe, expect, it } from 'vitest';
import { parseRef } from '@/lib/core/refs';
import { areaHits, goalHits, type GoalItemRow } from './goals-map';

const row = (over: Partial<GoalItemRow> & { id: string; title: string }): GoalItemRow => ({
  level: 'step',
  parent_id: null,
  status: 'open',
  kind: 'mine',
  ...over,
});

const rows: GoalItemRow[] = [
  row({ id: 'g1', level: 'goal', kind: null, title: 'Run a marathon' }),
  row({ id: 's1', parent_id: 'g1', title: 'Base training' }),
  row({ id: 's2', parent_id: 's1', title: 'Buy running shoes', status: 'done' }),
  row({ id: 's3', parent_id: 's1', title: 'Pick a running club' }),
  row({ id: 'd1', parent_id: 'g1', title: 'Which running race?', kind: 'decision' }),
  row({ id: 'x1', parent_id: 'g1', title: 'Running blog', status: 'dropped' }),
  row({ id: 'o1', parent_id: 'gone', title: 'Orphan running step' }),
];

describe('goals search hits', () => {
  it('opens a goal on its own page', () => {
    expect(goalHits(rows, { query: 'marathon', limit: 6 })).toEqual([
      { module: 'goals', kind: 'goal', id: 'g1', ref: 'goals.items:g1', title: 'Run a marathon', subtitle: 'Goal', href: '/goals/g1' },
    ]);
  });

  it('opens a nested step on its goal, at the step', () => {
    const [hit] = goalHits(rows, { query: 'shoes', limit: 6 });
    expect(hit).toMatchObject({
      kind: 'step',
      ref: 'goals.items:s2',
      subtitle: 'Step · Run a marathon',
      href: '/goals/g1/s/s2',
    });
    expect(parseRef(hit.ref!)).toMatchObject({ table: 'goals.items', id: 's2' });
  });

  it('leaves out decisions, dropped rows and steps with no goal, and puts open first', () => {
    expect(goalHits(rows, { query: 'running', limit: 6 }).map((hit) => hit.id)).toEqual(['s3', 's2']);
  });

  it('lists everything with no query, up to the cap', () => {
    expect(goalHits(rows, { limit: 10 }).map((hit) => hit.id)).toEqual(['g1', 's1', 's3', 's2']);
    expect(goalHits(rows, { limit: 2 })).toHaveLength(2);
  });
});

describe('area search hits', () => {
  const areas = [
    { id: 'a1', name: 'Health' },
    { id: 'a2', name: 'Career' },
  ];

  it('opens an area on its own page', () => {
    expect(areaHits(areas, { query: 'heal', limit: 6 })).toEqual([
      { module: 'goals', kind: 'area', id: 'a1', ref: 'goals.areas:a1', title: 'Health', subtitle: 'Area', href: '/goals/area/a1' },
    ]);
    expect(parseRef(areaHits(areas, { query: 'career', limit: 6 })[0].ref!)).toMatchObject({ table: 'goals.areas', id: 'a2' });
  });

  it('lists every area with no query, up to the limit', () => {
    expect(areaHits(areas, { limit: 1 }).map((hit) => hit.id)).toEqual(['a1']);
  });
});
