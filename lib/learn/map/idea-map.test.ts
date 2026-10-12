import { describe, expect, it } from 'vitest';
import type { KnowledgeState } from '@/lib/learn/graph/model';
import { buildIdeaMap, NEIGHBOURS_PER_IDEA, type IdeaVector } from './idea-map';

/**
 * A fixed set of twelve ideas in three groups of four. Each group sits along
 * its own axis of a six-dimensional space, and each idea leans a little off
 * that axis by its own amount, so within a group the ideas are close and
 * across groups they are far apart. The c group also leans towards the b
 * group, so an idea's nearest outside its own group are not a tie.
 */
function idea(id: string, group: number, lean: number, state: KnowledgeState = 'unknown'): IdeaVector {
  const vector = [0, 0, 0, 0, 0, 0];
  vector[group * 2] = 1;
  vector[group * 2 + 1] = lean;
  if (group === 2) vector[2] = 0.3;
  return { id, vector, state };
}

const IDEAS: IdeaVector[] = [
  idea('a1', 0, 0.0, 'known'),
  idea('a2', 0, 0.05, 'sharp'),
  idea('a3', 0, 0.3, 'known'),
  idea('a4', 0, 0.6),
  idea('b1', 1, 0.0),
  idea('b2', 1, 0.2, 'shaky'),
  idea('b3', 1, 0.4),
  idea('b4', 1, 0.8, 'known'),
  idea('c1', 2, 0.0, 'recognised'),
  idea('c2', 2, 0.1),
  idea('c3', 2, 0.5),
  idea('c4', 2, 1.0),
];

function groupOf(id: string): string {
  return id[0]!;
}

describe('buildIdeaMap', () => {
  const map = buildIdeaMap(IDEAS);

  it('places every idea on both layouts inside the -1 to 1 square', () => {
    expect(map.ideas.map((i) => i.id)).toEqual(IDEAS.map((i) => i.id));
    for (const { pca, neighbourMap } of map.ideas) {
      for (const p of [pca, neighbourMap]) {
        expect(Math.abs(p.x)).toBeLessThanOrEqual(1 + 1e-9);
        expect(Math.abs(p.y)).toBeLessThanOrEqual(1 + 1e-9);
      }
    }
  });

  it("lists each idea's six nearest, closest first, its own group before the rest", () => {
    for (const { id, neighbours } of map.ideas) {
      expect(neighbours).toHaveLength(NEIGHBOURS_PER_IDEA);
      expect(neighbours.map((n) => n.id)).not.toContain(id);
      const similarities = neighbours.map((n) => n.similarity);
      expect([...similarities].sort((a, b) => b - a)).toEqual(similarities);
      expect(neighbours.slice(0, 3).every((n) => groupOf(n.id) === groupOf(id))).toBe(true);
    }
    const a1 = map.ideas.find((i) => i.id === 'a1')!;
    expect(a1.neighbours[0]).toEqual({ id: 'a2', similarity: expect.closeTo(1 / Math.sqrt(1.0025), 12) });
  });

  it('reports the variance the two components keep', () => {
    // Three groups on three separate axes: two components can hold most of
    // it but not all.
    expect(map.variance.first).toBeGreaterThan(0.3);
    expect(map.variance.second).toBeGreaterThan(0.2);
    expect(map.variance.first).toBeGreaterThanOrEqual(map.variance.second);
    expect(map.variance.first + map.variance.second).toBeLessThan(1);
  });

  it('keeps the groups apart on the neighbour map', () => {
    const at = new Map(map.ideas.map((i) => [i.id, i.neighbourMap]));
    const distance = (x: string, y: string) => Math.hypot(at.get(x)!.x - at.get(y)!.x, at.get(x)!.y - at.get(y)!.y);
    const ids = IDEAS.map((i) => i.id);
    let within = 0;
    let withinCount = 0;
    let across = 0;
    let acrossCount = 0;
    for (const x of ids) {
      for (const y of ids) {
        if (x >= y) continue;
        if (groupOf(x) === groupOf(y)) {
          within += distance(x, y);
          withinCount++;
        } else {
          across += distance(x, y);
          acrossCount++;
        }
      }
    }
    expect(within / withinCount).toBeLessThan(across / acrossCount / 2);
  });

  it('lists pairs at 0.86 similarity or more, closest first, each once', () => {
    expect(map.similarPairs.map((p) => [p.a, p.b])).toEqual([
      ['a1', 'a2'],
      ['c1', 'c2'],
      ['b2', 'b3'],
      ['b1', 'b2'],
      ['a2', 'a3'],
      ['a3', 'a4'],
      ['a1', 'a3'],
      ['b3', 'b4'],
      ['c3', 'c4'],
      ['c2', 'c3'],
      ['b1', 'b3'],
      ['c1', 'c3'],
      ['b2', 'b4'],
      ['a2', 'a4'],
    ]);
    expect(map.similarPairs[0]!.similarity).toBeCloseTo(0.9988, 4);
    expect(map.similarPairs.at(-1)!.similarity).toBeCloseTo(0.8821, 4);
  });

  it('lists untested ideas with three or more known ideas among their six nearest', () => {
    // a4 has a1, a2 and a3 near it, all known or sharp. b1 and b3 have only b4.
    expect(map.untestedNearKnown).toEqual([
      {
        id: 'a4',
        known: [
          { id: 'a3', similarity: expect.any(Number) },
          { id: 'a2', similarity: expect.any(Number) },
          { id: 'a1', similarity: expect.any(Number) },
        ],
      },
    ]);
  });

  it('gives the same map whatever order the ideas arrive in', () => {
    expect(buildIdeaMap([...IDEAS].reverse())).toEqual(map);
  });

  it('copes with no ideas and with fewer than six', () => {
    const empty = buildIdeaMap([]);
    expect(empty.ideas).toEqual([]);
    expect(empty.variance).toEqual({ first: 0, second: 0 });
    const few = buildIdeaMap(IDEAS.slice(0, 3));
    expect(few.ideas.map((i) => i.neighbours.length)).toEqual([2, 2, 2]);
  });
});
