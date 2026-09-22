import { describe, expect, it } from 'vitest';
import { allKeys, edgeKey, keepTickedMap } from './keep';
import { noteMapSchema, type NoteMap } from './proposal';

const position = (key: string, themes: string[]) => ({
  key,
  name: `Position ${key}`,
  statement: `Statement ${key}`,
  kind: 'claim' as const,
  stance: 'held' as const,
  basis: 'Read in the section "Intro".',
  quote: `quote ${key}`,
  themes,
});

const map: NoteMap = {
  themes: [
    { key: 't0', name: 'Pricing', about: 'How prices are set.', basis: 'b' },
    { key: 't1', name: 'Hiring', about: 'Who gets hired.', basis: 'b' },
  ],
  positions: [position('p0', ['t0']), position('p1', ['t0', 't1']), position('p2', ['t1'])],
  edges: [
    { from: 'p0', to: 'p1', type: 'supports', description: null },
    { from: 'p1', to: 'p2', type: 'contradicts', description: 'They disagree.' },
  ],
};

describe('keepTickedMap', () => {
  it('keeps everything when everything is ticked', () => {
    const { map: kept, unplaced } = keepTickedMap(map, new Set(allKeys(map)));
    expect(kept).toEqual(map);
    expect(unplaced).toEqual([]);
  });

  it('takes an unticked theme off its positions and holds back one left with none', () => {
    const ticked = new Set(allKeys(map));
    ticked.delete('t1');
    const { map: kept, unplaced } = keepTickedMap(map, ticked);

    expect(kept.themes.map((t) => t.key)).toEqual(['t0']);
    expect(kept.positions.map((p) => [p.key, p.themes])).toEqual([
      ['p0', ['t0']],
      ['p1', ['t0']],
    ]);
    expect(unplaced.map((p) => p.key)).toEqual(['p2']);
    // The edge to the held-back position goes with it.
    expect(kept.edges.map(edgeKey)).toEqual(['p0>p1:supports']);
  });

  it('drops an edge whose end is unticked, and an edge unticked on its own', () => {
    const ticked = new Set(allKeys(map));
    ticked.delete('p0');
    expect(keepTickedMap(map, ticked).map.edges.map(edgeKey)).toEqual(['p1>p2:contradicts']);

    const noEdge = new Set(allKeys(map));
    noEdge.delete('p1>p2:contradicts');
    expect(keepTickedMap(map, noEdge).map.edges.map(edgeKey)).toEqual(['p0>p1:supports']);
  });

  it('always leaves a map the accept schema takes', () => {
    const ticked = new Set(allKeys(map));
    ticked.delete('t0');
    ticked.delete('p2');
    const { map: kept } = keepTickedMap(map, ticked);
    expect(noteMapSchema.safeParse(kept).success).toBe(true);
    expect(kept.positions.map((p) => [p.key, p.themes])).toEqual([['p1', ['t1']]]);
    expect(kept.edges).toEqual([]);
  });
});
