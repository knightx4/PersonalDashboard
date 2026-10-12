import { describe, expect, it } from 'vitest';
import { buildAreaMap, placeAreas, type FieldVector } from './area-map';
import { buildIdeaMap, type IdeaVector } from './idea-map';

const DIM = 16;
/** A vector along axis `a`, leaning onto axis `b`. */
function v(a: number, b = a, lean = 0): number[] {
  const out = new Array<number>(DIM).fill(0);
  out[a] = 1;
  out[b] += lean;
  return out;
}

const IDEAS: IdeaVector[] = [
  { id: 'i1', vector: v(0), state: 'known' },
  { id: 'i2', vector: v(0, 1, 0.2), state: 'unknown' },
  { id: 'i3', vector: v(4), state: 'unknown' },
  { id: 'i4', vector: v(4, 5, 0.2), state: 'known' },
  { id: 'i5', vector: v(8), state: 'unknown' },
  { id: 'i6', vector: v(8, 9, 0.3), state: 'unknown' },
];
const FIELDS: FieldVector[] = [
  { id: 'f1', domainId: 'd1', vector: v(0, 1, 0.1) },
  { id: 'f2', domainId: 'd1', vector: v(4, 5, 0.1) },
  { id: 'f3', domainId: 'd2', vector: v(8, 9, 0.1) },
  // Under no idea at all: ground not visited.
  { id: 'f4', domainId: 'd2', vector: v(12) },
];
const DOMAINS = [{ id: 'd1' }, { id: 'd2' }, { id: 'd3' }];

describe('placeAreas', () => {
  const { areas } = buildAreaMap(IDEAS, FIELDS, DOMAINS);

  it('places every field in both layouts, including one with no ideas near it', () => {
    expect(areas.fields.map((f) => f.id)).toEqual(['f1', 'f2', 'f3', 'f4']);
    for (const f of areas.fields) {
      for (const p of [f.pca, f.neighbourMap]) {
        expect(Number.isFinite(p.x) && Number.isFinite(p.y)).toBe(true);
      }
    }
  });

  it('puts a field beside the ideas it is closest to', () => {
    const map = buildIdeaMap(IDEAS);
    const at = (id: string) => map.ideas.find((i) => i.id === id)!.neighbourMap;
    const f1 = areas.fields.find((f) => f.id === 'f1')!.neighbourMap;
    const dist = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot(a.x - b.x, a.y - b.y);
    expect(dist(f1, at('i1'))).toBeLessThan(dist(f1, at('i5')));
  });

  it('places a domain at the mean of its fields, and skips one with none', () => {
    expect(areas.domains.map((d) => d.id)).toEqual(['d1', 'd2']);
    const [f1, f2] = areas.fields;
    const d1 = areas.domains[0]!;
    expect(d1.fields).toBe(2);
    expect(d1.pca.x).toBeCloseTo((f1!.pca.x + f2!.pca.x) / 2, 10);
    expect(d1.neighbourMap.y).toBeCloseTo((f1!.neighbourMap.y + f2!.neighbourMap.y) / 2, 10);
  });

  it('gives the same answer whatever order the rows come in', () => {
    const map = buildIdeaMap(IDEAS);
    expect(placeAreas(IDEAS, map, [...FIELDS].reverse(), [...DOMAINS].reverse())).toEqual(areas);
  });

  it('lays fields out on their own when there are no ideas', () => {
    const empty = buildAreaMap([], FIELDS, DOMAINS).areas;
    expect(empty.fields).toHaveLength(4);
    expect(empty.domains).toHaveLength(2);
    expect(empty.fields[0]!.pca).toEqual(empty.fields[0]!.neighbourMap);
  });
});
