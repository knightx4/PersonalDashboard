import { describe, expect, it } from 'vitest';
import { averageLinkage, clusterPlaces, cosineDistances, cutJoins, PLACE_MAX, PLACE_MIN } from './cluster';

/**
 * Ideas as vectors around chosen directions. Each idea sits at `centre` plus
 * a small push along its own axis, so ideas round one centre are close and
 * ideas round different centres are as far apart as the centres.
 */
const DIMS = 200;

function axis(i: number): number[] {
  const v = new Array<number>(DIMS).fill(0);
  v[i] = 1;
  return v;
}

function mix(...parts: [number, number[]][]): number[] {
  const v = new Array<number>(DIMS).fill(0);
  for (const [weight, part] of parts) part.forEach((x, i) => (v[i]! += weight * x));
  return v;
}

let nextAxis = 100;
function around(prefix: string, centre: number[], count: number, spread = 0.25) {
  return Array.from({ length: count }, (_, i) => ({
    id: `${prefix}-${String(i).padStart(2, '0')}`,
    vector: mix([1, centre], [spread, axis(nextAxis++ % DIMS)]),
  }));
}

describe('clusterPlaces', () => {
  it('finds separate tight groups as places and leaves a stray idea in none', () => {
    nextAxis = 100;
    const ideas = [
      ...around('a', axis(0), 6),
      ...around('b', axis(1), 5),
      { id: 'stray', vector: axis(2) },
    ];
    const { places, ungrouped } = clusterPlaces(ideas);
    expect(places).toEqual([ideas.slice(0, 6).map((i) => i.id), ideas.slice(6, 11).map((i) => i.id)]);
    expect(ungrouped).toEqual(['stray']);
  });

  it(`leaves a group of fewer than ${PLACE_MIN} ideas in no place`, () => {
    nextAxis = 100;
    const ideas = [...around('a', axis(0), 5), ...around('small', axis(1), PLACE_MIN - 1)];
    const { places, ungrouped } = clusterPlaces(ideas);
    expect(places).toHaveLength(1);
    expect(ungrouped).toEqual(['small-00', 'small-01', 'small-02']);
  });

  it(`splits a group bigger than ${PLACE_MAX} into the two halves it was joined from`, () => {
    // Two subgroups of fifteen whose centres are close enough that, by
    // distance alone, all thirty would make one place.
    nextAxis = 100;
    const left = mix([1, axis(0)], [0.5, axis(1)]);
    const right = mix([1, axis(0)], [0.5, axis(2)]);
    const ideas = [...around('l', left, 15, 0.12), ...around('r', right, 15, 0.12)];

    const loose = clusterPlaces(ideas, { max: 100 });
    expect(loose.places).toHaveLength(1);
    expect(loose.places[0]).toHaveLength(30);

    const { places, ungrouped } = clusterPlaces(ideas);
    expect(places).toHaveLength(2);
    expect(places.map((p) => p.length)).toEqual([15, 15]);
    expect(places.map((p) => p[0]![0]).sort()).toEqual(['l', 'r']);
    for (const place of places) expect(new Set(place.map((id) => id[0])).size).toBe(1);
    expect(ungrouped).toEqual([]);
  });

  it('gives the same places whatever order the ideas come in', () => {
    nextAxis = 100;
    const ideas = [...around('a', axis(0), 6), ...around('b', axis(1), 7), { id: 'x', vector: axis(3) }];
    expect(clusterPlaces([...ideas].reverse())).toEqual(clusterPlaces(ideas));
  });

  it('handles no ideas and one idea', () => {
    expect(clusterPlaces([])).toEqual({ places: [], ungrouped: [] });
    expect(clusterPlaces([{ id: 'one', vector: axis(0) }])).toEqual({ places: [], ungrouped: ['one'] });
  });
});

describe('averageLinkage and cutJoins', () => {
  it('joins by the mean distance between groups, closest first', () => {
    // Four points on a line: 0, 1, 5, 6 as a distance table.
    const at = [0, 1, 5, 6];
    const n = at.length;
    const table = new Float64Array(n * n);
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) table[i * n + j] = Math.abs(at[i]! - at[j]!);
    const joins = averageLinkage(table, n);
    expect(joins.map((j) => j.distance)).toEqual([1, 1, 5]);
    // {0,1} to {5,6}: the mean of 5, 6, 4 and 5.
    expect(cutJoins(joins, n, { min: 2, max: 10, maxDistance: 2 }).places.map((p) => p.sort())).toEqual(
      expect.arrayContaining([
        [0, 1],
        [2, 3],
      ]),
    );
    expect(cutJoins(joins, n, { min: 2, max: 10, maxDistance: 5 }).places).toHaveLength(1);
    expect(cutJoins(joins, n, { min: 2, max: 3, maxDistance: 5 }).places).toHaveLength(2);
  });

  it('measures cosine distance whatever the vectors’ length', () => {
    const table = cosineDistances([
      [1, 0],
      [5, 0],
      [0, 2],
    ]);
    expect(table[1]).toBeCloseTo(0);
    expect(table[2]).toBeCloseTo(1);
  });
});
