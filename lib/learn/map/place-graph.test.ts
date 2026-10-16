import { describe, expect, it } from 'vitest';
import {
  LINKS_INSIDE,
  NEXT_DOOR_PLACE,
  graphHeight,
  ideaGraph,
  ladderFrom,
  ladderText,
  nodeBox,
  openFor,
  openedFrom,
  paramsFor,
  readableName,
  requirementText,
  spreadGraph,
  territoryGraph,
  wrapName,
  type GraphIdea,
  type SkyTerritory,
  type SpreadNode,
  type TerritoryTopicIn,
} from './place-graph';
import { overlaps } from './sky';

/**
 * Two places of five ideas side by side, ideas a1..a5 in A and b1..b5 in B,
 * and three ideas in no place. Each idea lists its six nearest by how close
 * its number is, with a score that falls with the distance.
 */
function fixture(): GraphIdea[] {
  const ids = ['a1', 'a2', 'a3', 'a4', 'a5', 'b1', 'b2', 'b3', 'b4', 'b5', 'x1', 'x2', 'x3'];
  return ids.map((id, i) => ({
    id,
    name: `Idea ${id}`,
    placeId: id.startsWith('a') ? 'A' : id.startsWith('b') ? 'B' : null,
    neighbours: ids
      .map((other, j) => ({ id: other, d: Math.abs(i - j) }))
      .filter((n) => n.id !== id)
      .sort((x, y) => x.d - y.d || x.id.localeCompare(y.id))
      .slice(0, 6)
      .map((n) => ({ id: n.id, similarity: 0.95 - n.d * 0.05 })),
  }));
}

const PLACES = [
  { id: 'A', name: 'Place A' },
  { id: 'B', name: 'Place B' },
];

describe('what a graph holds', () => {
  it('holds the place and its strongest neighbours next door, each door leading to its own place', () => {
    const graph = ideaGraph(fixture(), PLACES, { kind: 'place', id: 'A' })!;
    expect(graph.key).toBe('place:A');
    expect(graph.title).toBe('Place A');
    expect(graph.core).toEqual(['a1', 'a2', 'a3', 'a4', 'a5']);
    expect(graph.next.length).toBeLessThanOrEqual(NEXT_DOOR_PLACE);
    expect(graph.next[0]).toBe('b1');
    for (const id of graph.next) expect(graph.core).not.toContain(id);
    expect(graph.doors.get('b1')).toEqual({
      opened: { kind: 'place', id: 'B' },
      placeName: 'Place B',
    });
  });

  it('opens an idea in no place as its neighbourhood, and its doors to places or to other neighbourhoods', () => {
    const ideas = fixture();
    const graph = ideaGraph(ideas, PLACES, { kind: 'around', id: 'x2' })!;
    expect(graph.title).toBe('Idea x2');
    expect(graph.core[0]).toBe('x2');
    expect(graph.core).toHaveLength(7);
    for (const [, door] of graph.doors) {
      expect(['place', 'around']).toContain(door.opened.kind);
      if (door.opened.kind === 'around') expect(door.placeName).toBeNull();
    }
  });

  it('draws at most three links from each idea inside, and one to each idea next door', () => {
    const graph = ideaGraph(fixture(), PLACES, { kind: 'place', id: 'A' })!;
    const core = new Set(graph.core);
    for (const id of graph.core) {
      const inside = graph.edges.filter((e) => e.drawn && !e.out && (e.a === id || e.b === id));
      expect(inside.length).toBeGreaterThan(0);
    }
    for (const id of graph.next) {
      const own = graph.edges.filter((e) => e.a === id || e.b === id);
      expect(own.every((e) => e.out)).toBe(true);
      expect(own.some((e) => e.drawn)).toBe(true);
    }
    // No link joins two ideas next door: they only ever lead out of the place.
    for (const e of graph.edges) expect(core.has(e.a) || core.has(e.b)).toBe(true);
    // Each idea inside keeps its own three strongest links inside; a weaker
    // one is drawn only when the idea at its other end picked it.
    for (const id of graph.core) {
      const own = graph.edges
        .filter((e) => !e.out && (e.a === id || e.b === id))
        .sort((x, y) => y.similarity - x.similarity);
      for (const e of own.slice(0, LINKS_INSIDE)) expect(e.drawn).toBe(true);
    }
    expect(graph.edges.some((e) => !e.drawn)).toBe(true);
  });

  it('keeps the higher score where two ideas list each other', () => {
    const ideas: GraphIdea[] = [
      { id: 'p', name: 'p', placeId: 'A', neighbours: [{ id: 'q', similarity: 0.7 }] },
      { id: 'q', name: 'q', placeId: 'A', neighbours: [{ id: 'p', similarity: 0.8 }] },
    ];
    const graph = ideaGraph(ideas, PLACES, { kind: 'place', id: 'A' })!;
    expect(graph.edges).toHaveLength(1);
    expect(graph.edges[0]!.similarity).toBe(0.8);
  });

  it('shows the whole map for a place not named, a place with no ideas, or an idea not on the map', () => {
    const ideas = fixture();
    expect(ideaGraph(ideas, PLACES, { kind: 'place', id: 'C' })).toBeNull();
    expect(ideaGraph(ideas, [{ id: 'C', name: 'Empty' }], { kind: 'place', id: 'C' })).toBeNull();
    expect(ideaGraph(ideas, PLACES, { kind: 'around', id: 'gone' })).toBeNull();
    expect(ideaGraph([], [], { kind: 'around', id: 'x' })).toBeNull();
  });
});

describe('the address of a graph', () => {
  it('reads a place before a neighbourhood, and nothing when neither is set', () => {
    expect(openedFrom({ place: 'A', around: null })).toEqual({ kind: 'place', id: 'A' });
    expect(openedFrom({ place: null, around: 'x' })).toEqual({ kind: 'around', id: 'x' });
    expect(openedFrom({ place: null, around: null })).toBeNull();
  });

  it('opens an idea at its place when the place is named, else at its neighbourhood', () => {
    const named = new Set(['A']);
    expect(openFor({ id: 'a1', placeId: 'A' }, named)).toEqual({ kind: 'place', id: 'A' });
    expect(openFor({ id: 'z', placeId: 'Z' }, named)).toEqual({ kind: 'around', id: 'z' });
    expect(openFor({ id: 'x', placeId: null }, named)).toEqual({ kind: 'around', id: 'x' });
  });
});

describe('spreading it out', () => {
  it('ends with no two names overlapping and every one inside the frame', () => {
    const graph = ideaGraph(fixture(), PLACES, { kind: 'place', id: 'A' })!;
    const ids = [...graph.core, ...graph.next];
    // Everyone starts in nearly one spot, the hardest case for the spread.
    const nodes: SpreadNode[] = ids.map((id, i) => ({
      id,
      core: graph.core.includes(id),
      at: { x: 0.01 * (i % 3), y: 0.01 * Math.floor(i / 3) },
      w: 120,
      h: 34,
      r: graph.core.includes(id) ? 7 : 4.5,
    }));
    const width = 640;
    const height = graphHeight(width, nodes.length, 400);
    const at = spreadGraph(nodes, graph.edges, width, height);
    const boxes = nodes.map((n) => nodeBox(n, at.get(n.id)!));
    for (const box of boxes) {
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.y).toBeGreaterThanOrEqual(0);
      expect(box.x + box.w).toBeLessThanOrEqual(width);
      expect(box.y + box.h).toBeLessThanOrEqual(height);
    }
    for (let i = 0; i < boxes.length; i++) {
      for (let j = i + 1; j < boxes.length; j++) expect(overlaps(boxes[i]!, boxes[j]!)).toBe(false);
    }
  });

  it('keeps the rough shape of the map: what was left stays left', () => {
    const nodes: SpreadNode[] = [
      { id: 'w', core: true, at: { x: -1, y: 0 }, w: 60, h: 16, r: 7 },
      { id: 'e', core: true, at: { x: 1, y: 0 }, w: 60, h: 16, r: 7 },
      { id: 'n', core: true, at: { x: 0, y: 1 }, w: 60, h: 16, r: 7 },
      { id: 's', core: true, at: { x: 0, y: -1 }, w: 60, h: 16, r: 7 },
    ];
    const at = spreadGraph(nodes, [], 600, 400);
    expect(at.get('w')!.x).toBeLessThan(at.get('e')!.x);
    // Up on the map is up on the screen, where y grows downwards.
    expect(at.get('n')!.y).toBeLessThan(at.get('s')!.y);
  });

  it('grows the frame for a big place, within a cap, and never below the map', () => {
    expect(graphHeight(1000, 2, 600)).toBe(600);
    expect(graphHeight(1000, 20, 400)).toBe(120 + 20 * 34);
    expect(graphHeight(1000, 100, 400)).toBe(1000);
    expect(graphHeight(390, 30, 390)).toBe(1300);
  });
});

describe('names in full', () => {
  const measure = (text: string) => text.length * 6;

  it('breaks a name into lines at spaces and keeps every word', () => {
    const { lines, width } = wrapName('The rule of forty in a software business', 90, measure);
    expect(lines.join(' ')).toBe('The rule of forty in a software business');
    expect(lines.length).toBeGreaterThan(1);
    expect(width).toBeLessThanOrEqual(90);
  });

  it('reads a code-style name as words', () => {
    expect(readableName('net_interest_margin')).toBe('Net interest margin');
    expect(readableName('Already words_here and spaced')).toBe('Already words_here and spaced');
    expect(readableName('Plain')).toBe('Plain');
  });
});

describe('a territory as a graph (plan #2187.3)', () => {
  const ladder = (id: string, extra: Partial<TerritoryTopicIn> = {}): TerritoryTopicIn => ({
    id,
    name: `Topic ${id}`,
    pca: { x: 0, y: 0 },
    neighbourMap: { x: id.charCodeAt(0) / 100, y: 0 },
    ceiling: 8,
    tested: 0,
    held: 0,
    target: 5,
    missed: [],
    slot: 0,
    ideaIds: [],
    ...extra,
  });
  const link = (a: string, at: number, b: string, needs: number) => ({
    requiringTopicId: a,
    requiringLevel: at,
    requiredTopicId: b,
    requiredLevel: needs,
  });
  const territory: SkyTerritory = {
    id: 'g',
    name: 'A goal',
    topics: [
      ladder('a', { ideaIds: ['a1', 'a2'] }),
      ladder('b', { ideaIds: ['a2', 'b1'] }),
      ladder('c', { ideaIds: ['a2'] }),
    ],
    // c requires b, b requires a, and c requires a directly too; a link within a topic is its ladder.
    links: [
      link('c', 3, 'b', 2),
      link('c', 5, 'b', 4),
      link('b', 2, 'a', 3),
      link('c', 2, 'a', 1),
      link('a', 2, 'a', 1),
    ],
  };

  it('draws its topics as the stars, opened on the topic tapped', () => {
    const graph = territoryGraph(territory, 'b', fixture(), PLACES)!;
    expect(graph.key).toBe('territory:g');
    expect(graph.opened).toEqual({ kind: 'territory', id: 'g', topic: 'b' });
    expect(graph.title).toBe('A goal');
    expect(graph.core).toEqual(['a', 'b', 'c']);
    expect(graph.ladders!.get('a')!.at).toEqual({ x: 0.97, y: 0 });
    const axes = territoryGraph(territory, 'b', fixture(), PLACES, 'axes')!;
    expect(axes.ladders!.get('a')!.at).toEqual({ x: 0, y: 0 });
  });

  it('makes each line a requirement pointing at the topic required, with every level pair it binds', () => {
    const graph = territoryGraph(territory, 'a', fixture(), PLACES)!;
    const requires = graph.edges.filter((x) => x.requires);
    expect(requires.map((x) => `${x.a}>${x.b}`)).toEqual(['b>a', 'c>a', 'c>b']);
    const cb = requires.find((x) => x.a === 'c' && x.b === 'b')!;
    expect(cb.requires!.binds).toEqual([
      { at: 3, needs: 2 },
      { at: 5, needs: 4 },
    ]);
    expect(requirementText(cb.requires!)).toBe('needs 2, 4');
  });

  it('leaves a link a longer path already says off at rest, and shows it while pointed at', () => {
    const graph = territoryGraph(territory, 'a', fixture(), PLACES)!;
    const drawn = (a: string, b: string) => graph.edges.find((x) => x.a === a && x.b === b)!.drawn;
    expect(drawn('c', 'b')).toBe(true);
    expect(drawn('b', 'a')).toBe(true);
    expect(drawn('c', 'a')).toBe(false);
  });

  it('puts the ideas under the most topics next door, each with one line out', () => {
    const graph = territoryGraph(territory, 'a', fixture(), PLACES)!;
    expect(graph.next[0]).toBe('a2');
    expect(new Set(graph.next)).toEqual(new Set(['a1', 'a2', 'b1']));
    const out = graph.edges.filter((x) => x.out);
    expect(out).toHaveLength(3);
    expect(out.every((x) => x.drawn && !x.requires)).toBe(true);
    expect(graph.doors.get('b1')).toEqual({ opened: { kind: 'place', id: 'B' }, placeName: 'Place B' });
  });

  it('shows the whole map for a topic not in the territory', () => {
    expect(territoryGraph(territory, 'zz', fixture(), PLACES)).toBeNull();
    expect(ideaGraph(fixture(), PLACES, { kind: 'territory', id: 'g', topic: 'a' })).toBeNull();
  });

  it('reads the address of a territory before a place, and leaves it keeping the goal', () => {
    expect(openedFrom({ place: 'A', around: null, goal: 'g', topic: 't' })).toEqual({
      kind: 'territory',
      id: 'g',
      topic: 't',
    });
    expect(openedFrom({ place: 'A', around: null, goal: 'g', topic: null })).toEqual({ kind: 'place', id: 'A' });
    expect(paramsFor({ kind: 'territory', id: 'g', topic: 't' })).toEqual({
      place: null,
      around: null,
      goal: 'g',
      topic: 't',
      idea: null,
    });
    expect(paramsFor({ kind: 'place', id: 'A' })).toEqual({ place: 'A', around: null, topic: null, idea: null });
  });

  it('reads a ladder off the cells, keeping tested apart from held', () => {
    expect(
      ladderFrom([
        { level: 1, status: 'implied' },
        { level: 2, status: 'shown' },
        { level: 3, status: 'implied' },
        { level: 4, status: 'missed' },
        { level: 5, status: 'declared' },
        { level: 6, status: 'open' },
      ]),
    ).toEqual({ tested: 2, held: 5, missed: [4] });
    expect(ladderFrom([])).toEqual({ tested: 0, held: 0, missed: [] });
  });

  it('says a star level line with tested apart and the target', () => {
    const base = { id: 'x', name: 'X', at: { x: 0, y: 0 }, ceiling: 8, missed: [], slot: 0 };
    expect(ladderText({ ...base, tested: 2, held: 5, target: 6 })).toBe('Level 5 of 8, 2 tested, target 6');
    expect(ladderText({ ...base, tested: 0, held: 3, target: null })).toBe('Level 3 of 8, none tested');
    expect(ladderText({ ...base, tested: 4, held: 4, target: 4 })).toBe('Level 4 of 8, target 4');
  });
});
