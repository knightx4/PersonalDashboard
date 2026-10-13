import { describe, expect, it } from 'vitest';
import {
  LINKS_INSIDE,
  NEXT_DOOR_PLACE,
  graphHeight,
  ideaGraph,
  nodeBox,
  openFor,
  openedFrom,
  readableName,
  spreadGraph,
  wrapName,
  type GraphIdea,
  type SpreadNode,
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
