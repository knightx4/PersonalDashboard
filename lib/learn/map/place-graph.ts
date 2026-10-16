import { isHeld, type CellStatus } from '@/lib/learn/levels/model';
import type { Point } from './layout';

/**
 * One place on Idea Space opened as a graph of its own (plan #1997.7), apart
 * from the page so it can be tested without a browser.
 *
 * - Which ideas the graph holds: the place's own, then the ideas next door
 *   that its strongest links out lead to. An idea in no place opens its
 *   neighbourhood instead: itself and its six nearest.
 * - Which links are drawn: each idea's three strongest inside the graph, and
 *   one to each idea next door. Pointing at an idea shows the rest of its six.
 * - Where each idea goes: it starts where the map has it and is spread by a
 *   small force pass until no two names overlap, so the place keeps its rough
 *   shape from the map (the Idea Space Places mock).
 *
 * Nothing is stored: the graph is drawn from the six-nearest links the page
 * already holds.
 */

/** What is opened: a named place by its id, or the neighbourhood of an idea by the idea's id. */
export type Opened =
  | { kind: 'place'; id: string }
  | { kind: 'around'; id: string }
  /** A goal's territory (plan #2187.3), by the lens's id, opened on one of its topics. */
  | { kind: 'territory'; id: string; topic: string };

export type GraphIdea = {
  id: string;
  name: string;
  placeId: string | null;
  neighbours: readonly { id: string; similarity: number }[];
};

export type GraphEdge = {
  a: string;
  b: string;
  similarity: number;
  /** A link out of the place, to an idea next door. */
  out: boolean;
  /** Drawn at rest; the others show only while one of their ends is pointed at. */
  drawn: boolean;
  /** In a territory, a requirement: `a` requires `b`, at the levels it binds. */
  requires?: Requirement;
};

export type IdeaGraph = {
  /** Which graph this is, the same on every visit: `place:<id>` or `around:<id>`. */
  key: string;
  opened: Opened;
  /** The place's name, or the idea's for a neighbourhood. */
  title: string;
  /** The place's own ideas, or the idea and its six nearest. */
  core: string[];
  /** The ideas next door, strongest link first. */
  next: string[];
  /** Where a tap on each idea next door goes: its place, or its neighbourhood when it is in none. */
  doors: Map<string, { opened: Opened; placeName: string | null }>;
  edges: GraphEdge[];
  /** In a territory, each topic's ladder: its stars are topics, not ideas. */
  ladders?: Map<string, Ladder>;
  /** In a territory, the route through the stars you are ready for, in the order to take them. */
  route?: RouteStep[];
};

/** One stop on a territory's route (plan #2187.4): the star, the level to take there, and its cell. */
export type RouteStep = {
  /** Its place on the route, from 1. */
  n: number;
  topicId: string;
  level: number;
  /** The cell Start here asks about on the first stop. */
  cellId: string;
};

/** How many ideas next door a place shows, and a neighbourhood. */
export const NEXT_DOOR_PLACE = 7;
export const NEXT_DOOR_AROUND = 6;
/** Links drawn at rest from each idea inside the graph. */
export const LINKS_INSIDE = 3;

export function openedFrom(params: {
  place: string | null;
  around: string | null;
  goal?: string | null;
  topic?: string | null;
}): Opened | null {
  if (params.goal && params.topic) return { kind: 'territory', id: params.goal, topic: params.topic };
  if (params.place) return { kind: 'place', id: params.place };
  if (params.around) return { kind: 'around', id: params.around };
  return null;
}

/**
 * The change of address that opens `to`, letting go of the idea open in the
 * rail. Leaving a territory for a place keeps the goal chosen.
 */
export function paramsFor(to: Opened): {
  place: string | null;
  around: string | null;
  topic: string | null;
  idea: null;
  goal?: string;
} {
  if (to.kind === 'territory') return { place: null, around: null, goal: to.id, topic: to.topic, idea: null };
  return {
    place: to.kind === 'place' ? to.id : null,
    around: to.kind === 'around' ? to.id : null,
    topic: null,
    idea: null,
  };
}

/** Where a tap on an idea goes: its place when it has a named one, otherwise its neighbourhood. */
export function openFor(
  idea: { id: string; placeId: string | null },
  named: ReadonlySet<string>,
): Opened {
  return idea.placeId && named.has(idea.placeId)
    ? { kind: 'place', id: idea.placeId }
    : { kind: 'around', id: idea.id };
}

/**
 * The graph `opened` stands for, or null when it names a place that is not
 * named on the map or an idea that is not on it, so a stale link shows the
 * whole map.
 */
export function ideaGraph(
  ideas: readonly GraphIdea[],
  places: readonly { id: string; name: string }[],
  opened: Opened,
): IdeaGraph | null {
  if (opened.kind === 'territory') return null;
  const byId = new Map(ideas.map((idea) => [idea.id, idea]));
  const placeName = new Map(places.map((place) => [place.id, place.name]));
  const named = new Set(placeName.keys());

  let core: string[];
  let title: string;
  if (opened.kind === 'place') {
    const name = placeName.get(opened.id);
    if (!name) return null;
    core = ideas.filter((idea) => idea.placeId === opened.id).map((idea) => idea.id);
    if (core.length === 0) return null;
    title = name;
  } else {
    const idea = byId.get(opened.id);
    if (!idea) return null;
    core = [
      idea.id,
      ...idea.neighbours.map((n) => n.id).filter((id) => byId.has(id) && id !== idea.id),
    ];
    title = idea.name;
  }

  // Links both ways, keeping the higher score where both ideas list each other.
  const link = new Map<string, Map<string, number>>();
  const linkOf = (id: string) => {
    let row = link.get(id);
    if (!row) link.set(id, (row = new Map()));
    return row;
  };
  for (const idea of ideas) {
    for (const n of idea.neighbours) {
      if (n.id === idea.id || !byId.has(n.id)) continue;
      linkOf(idea.id).set(n.id, Math.max(linkOf(idea.id).get(n.id) ?? 0, n.similarity));
      linkOf(n.id).set(idea.id, Math.max(linkOf(n.id).get(idea.id) ?? 0, n.similarity));
    }
  }

  // Next door: the outside ideas the core's links lead to, by their summed scores.
  const inCore = new Set(core);
  const pull = new Map<string, number>();
  for (const id of core) {
    for (const [other, s] of link.get(id) ?? []) {
      if (!inCore.has(other)) pull.set(other, (pull.get(other) ?? 0) + s);
    }
  }
  const next = [...pull.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, opened.kind === 'place' ? NEXT_DOOR_PLACE : NEXT_DOOR_AROUND)
    .map(([id]) => id);

  const shown = new Set([...core, ...next]);
  const all: GraphEdge[] = [];
  for (const a of shown) {
    for (const [b, s] of link.get(a) ?? []) {
      if (a >= b || !shown.has(b)) continue;
      if (!inCore.has(a) && !inCore.has(b)) continue;
      all.push({ a, b, similarity: s, out: !(inCore.has(a) && inCore.has(b)), drawn: false });
    }
  }
  for (const id of shown) {
    const own = all
      .filter((edge) => (edge.a === id || edge.b === id) && (inCore.has(id) ? !edge.out : true))
      .sort((x, y) => y.similarity - x.similarity);
    for (const edge of own.slice(0, inCore.has(id) ? LINKS_INSIDE : 1)) edge.drawn = true;
  }

  const doors = new Map<string, { opened: Opened; placeName: string | null }>();
  for (const id of next) {
    const idea = byId.get(id)!;
    const to = openFor(idea, named);
    doors.set(id, { opened: to, placeName: to.kind === 'place' ? placeName.get(to.id)! : null });
  }

  return { key: `${opened.kind}:${opened.id}`, opened, title, core, next, doors, edges: all };
}

// -- A territory's graph (plan #2187.3) -------------------------------------------

/**
 * One topic of a territory as its popup draws it: a star whose arc says how
 * far up its ladder you are and whose dashed ring says where the goal wants
 * you. Tested and held are kept apart (docs/LEARN-LEVELS-SPEC.md, "How counts
 * are reported"): the arc is solid as far as a graded answer showed and
 * fainter beyond it, as far as you hold by inference or declaration.
 */
export type Ladder = {
  id: string;
  name: string;
  /** Where the sky puts the topic, in the layout's units: its frame topic's place. */
  at: Point;
  /** The highest level with content. */
  ceiling: number;
  /** The highest level a graded answer showed, 0 for none. */
  tested: number;
  /** The highest level held at all (shown, implied or declared), never below `tested`. */
  held: number;
  /** The level the goal asks for, or null when the topic is in the territory without a target. */
  target: number | null;
  /** Levels whose latest answer missed, lowest first. */
  missed: number[];
  /** The domain's colour slot, as a star's. */
  slot: number | 'other' | 'none';
};

/**
 * A territory's topic as the page hands it over: its ladder, where it sits
 * in each layout (its frame topic's place on the sky), and the ideas under it.
 */
export type TerritoryTopicIn = Omit<Ladder, 'at'> & {
  pca: Point;
  neighbourMap: Point;
  /** The ideas on the map under the topic's frame topic, which the ideas next door are drawn from. */
  ideaIds: readonly string[];
};

/** One requirement between cells, read at topic level: `requiring` at a level needs `required` at a level. */
export type TerritoryLinkIn = {
  requiringTopicId: string;
  requiringLevel: number;
  requiredTopicId: string;
  requiredLevel: number;
};

/** A cell inside the goal that you are ready for: one row of the fringe (lib/learn/levels/model.ts `fringe`). */
export type TerritoryReadyIn = {
  topicId: string;
  level: number;
  cellId: string;
  /** Why it is ready, in a sentence (`fringeWhy`), where the loader wrote it (plan #2187.5). */
  why?: string;
};

/**
 * Why a territory's topic stands where it does (plan #2187.5): the highest
 * level held on it, how it is held, since when, the quote of the answer that
 * shows it, and the day it falls due a re-check. `via` names the answer that
 * implies a level held by inference.
 */
export type TerritoryStanding = {
  topicId: string;
  level: number;
  how: 'tested' | 'inferred' | 'declared';
  /** The cell at that level, which a re-check asks about. */
  cellId: string;
  since: string;
  dueOn: string;
  quote: string | null;
  via: { topicName: string; level: number } | null;
};

/** A goal's territory: its topics and the requirement links between their cells. */
export type SkyTerritory = {
  /** The lens the territory is the targets of. */
  id: string;
  name: string;
  topics: readonly TerritoryTopicIn[];
  links: readonly TerritoryLinkIn[];
  /**
   * The cells at or below the goal's targets that you are ready for, in the
   * order the engine would ask them: the fringe, misses first, then what
   * settles most. Absent when the loader has not read it.
   */
  ready?: readonly TerritoryReadyIn[];
  /** Why each topic with a level held stands there (plan #2187.5). */
  standing?: readonly TerritoryStanding[];
};

/** What a requirement line carries: every pair of levels it binds, lowest required level first. */
export type Requirement = { binds: { at: number; needs: number }[] };

/** How many ideas next door a territory shows round its edge. */
export const NEXT_DOOR_TERRITORY = NEXT_DOOR_PLACE;
/** The weight a requirement line pulls with when the graph is spread, on the similarity scale. */
const REQUIRES_PULL = 0.8;
/** The weight a line to an idea next door pulls with. */
const NEXT_DOOR_PULL = 0.5;

/**
 * The route through a territory: each star you are ready for once, at the
 * cell the engine would ask first on it, numbered in the engine's order.
 */
export function routeFrom(
  ready: readonly TerritoryReadyIn[] | undefined,
  topics: ReadonlySet<string>,
): RouteStep[] {
  const seen = new Set<string>();
  const route: RouteStep[] = [];
  for (const cell of ready ?? []) {
    if (!topics.has(cell.topicId) || seen.has(cell.topicId)) continue;
    seen.add(cell.topicId);
    route.push({ n: route.length + 1, topicId: cell.topicId, level: cell.level, cellId: cell.cellId });
  }
  return route;
}

/** The ladder a topic shows, read off the cells' statuses (lib/learn/levels/model.ts `readCells`). */
export function ladderFrom(cells: readonly { level: number; status: CellStatus }[]): Pick<Ladder, 'tested' | 'held' | 'missed'> {
  let tested = 0;
  let held = 0;
  const missed: number[] = [];
  for (const cell of cells) {
    if (cell.status === 'shown') tested = Math.max(tested, cell.level);
    if (isHeld(cell.status)) held = Math.max(held, cell.level);
    if (cell.status === 'missed') missed.push(cell.level);
  }
  return { tested, held: Math.max(held, tested), missed: missed.sort((a, b) => a - b) };
}

/**
 * The graph a territory opens as when one of its topics is tapped, or null
 * when the territory or the topic is not on the page, so a stale link shows
 * the whole map.
 *
 * - Its stars are the territory's topics, each with its ladder.
 * - Its lines are requirement links, one per pair of topics, pointing from
 *   the topic that requires to the topic it requires (`a` requires `b`),
 *   carrying every level pair the cell links bind. A link within a topic is
 *   the ladder itself and is never drawn.
 * - At rest only the links no longer path already says are drawn, so a chain
 *   reads as a chain; pointing at a star shows all of its links.
 * - Round the edge, as in a place, sit the ideas next door: the ideas under
 *   the most of the territory's topics, each joined to one topic it sits under.
 */
export function territoryGraph(
  territory: SkyTerritory,
  topicId: string,
  ideas: readonly GraphIdea[],
  places: readonly { id: string; name: string }[],
  layout: 'neighbours' | 'axes' = 'neighbours',
): IdeaGraph | null {
  const ladders = new Map<string, Ladder>();
  for (const t of territory.topics) {
    ladders.set(t.id, {
      id: t.id,
      name: t.name,
      at: layout === 'axes' ? t.pca : t.neighbourMap,
      ceiling: t.ceiling,
      tested: t.tested,
      held: t.held,
      target: t.target,
      missed: t.missed,
      slot: t.slot,
    });
  }
  if (!ladders.has(topicId)) return null;
  const core = [...ladders.keys()];

  // One line per pair, requiring first.
  const pairs = new Map<string, { a: string; b: string; binds: { at: number; needs: number }[] }>();
  for (const link of territory.links) {
    const { requiringTopicId: a, requiredTopicId: b } = link;
    if (a === b || !ladders.has(a) || !ladders.has(b)) continue;
    const key = `${a}>${b}`;
    const pair = pairs.get(key) ?? { a, b, binds: [] };
    if (!pair.binds.some((x) => x.at === link.requiringLevel && x.needs === link.requiredLevel)) {
      pair.binds.push({ at: link.requiringLevel, needs: link.requiredLevel });
    }
    pairs.set(key, pair);
  }
  const requires = new Map<string, string[]>();
  for (const { a, b } of pairs.values()) requires.set(a, [...(requires.get(a) ?? []), b]);
  // A link is implied when another way round reaches its end.
  const reachesOtherwise = (from: string, to: string): boolean => {
    const seen = new Set<string>([from]);
    const stack = (requires.get(from) ?? []).filter((n) => n !== to);
    while (stack.length > 0) {
      const id = stack.pop()!;
      if (id === to) return true;
      if (seen.has(id)) continue;
      seen.add(id);
      stack.push(...(requires.get(id) ?? []));
    }
    return false;
  };
  const edges: GraphEdge[] = [...pairs.values()]
    .sort((x, y) => x.a.localeCompare(y.a) || x.b.localeCompare(y.b))
    .map(({ a, b, binds }) => ({
      a,
      b,
      similarity: REQUIRES_PULL,
      out: false,
      drawn: !reachesOtherwise(a, b),
      requires: { binds: binds.sort((x, y) => x.needs - y.needs || x.at - y.at) },
    }));

  // Next door: the ideas under the most topics, then the first named.
  const byId = new Map(ideas.map((idea) => [idea.id, idea]));
  const under = new Map<string, string[]>();
  for (const topic of territory.topics) {
    for (const id of topic.ideaIds) {
      if (!byId.has(id) || ladders.has(id)) continue;
      const list = under.get(id) ?? [];
      if (!list.includes(topic.id)) list.push(topic.id);
      under.set(id, list);
    }
  }
  const next = [...under.entries()]
    .sort((x, y) => y[1].length - x[1].length)
    .slice(0, NEXT_DOOR_TERRITORY)
    .map(([id]) => id);
  for (const id of next) {
    edges.push({ a: under.get(id)![0]!, b: id, similarity: NEXT_DOOR_PULL, out: true, drawn: true });
  }

  const placeName = new Map(places.map((place) => [place.id, place.name]));
  const named = new Set(placeName.keys());
  const doors = new Map<string, { opened: Opened; placeName: string | null }>();
  for (const id of next) {
    const to = openFor(byId.get(id)!, named);
    doors.set(id, { opened: to, placeName: to.kind === 'place' ? placeName.get(to.id)! : null });
  }

  return {
    key: `territory:${territory.id}`,
    opened: { kind: 'territory', id: territory.id, topic: topicId },
    title: territory.name,
    core,
    next,
    doors,
    edges,
    ladders,
    route: routeFrom(territory.ready, new Set(ladders.keys())),
  };
}

/** A requirement line's label, shown while one of its ends is pointed at: the level it needs. */
export function requirementText(requirement: Requirement): string {
  const needs = [...new Set(requirement.binds.map((x) => x.needs))];
  return `needs ${needs.join(', ')}`;
}

/** A star's level line, shown while it is pointed at. */
export function ladderText(ladder: Ladder): string {
  const parts = [`Level ${ladder.held} of ${ladder.ceiling}`];
  if (ladder.held > ladder.tested) parts.push(ladder.tested > 0 ? `${ladder.tested} tested` : 'none tested');
  if (ladder.target !== null) parts.push(`target ${ladder.target}`);
  return parts.join(', ');
}

// -- Spreading it out ------------------------------------------------------------

export type SpreadNode = {
  id: string;
  /** In the place (true) or next door. */
  core: boolean;
  /** Where the map has it, in the layout's units, up being up. */
  at: Point;
  /** Its name's box below the mark, in pixels. */
  w: number;
  h: number;
  /** The mark's radius in pixels. */
  r: number;
};

/** The room kept round the frame's edge, in pixels. */
export const SPREAD_EDGE = 8;

/**
 * Where each idea goes in a frame `width` by `height` pixels: from its map
 * position, fitted to the frame, links pulling to a length that shortens as
 * they grow stronger, every pair pushing apart a little, and no two boxes
 * (each mark with its name beneath) allowed to overlap. Ideas next door are
 * held less tightly to the middle, so they settle round the edge.
 */
export function spreadGraph(
  nodes: readonly SpreadNode[],
  edges: readonly { a: string; b: string; similarity: number; out: boolean }[],
  width: number,
  height: number,
  iterations = 360,
): Map<string, Point> {
  const out = new Map<string, Point>();
  if (nodes.length === 0) return out;
  let x0 = Infinity;
  let x1 = -Infinity;
  let y0 = Infinity;
  let y1 = -Infinity;
  for (const n of nodes) {
    x0 = Math.min(x0, n.at.x);
    x1 = Math.max(x1, n.at.x);
    y0 = Math.min(y0, n.at.y);
    y1 = Math.max(y1, n.at.y);
  }
  const padX = Math.min(100, width * 0.2);
  const padY = Math.min(60, height * 0.12);
  const sx = Math.max(width - 2 * padX, 1) / (x1 - x0 || 1);
  const sy = Math.max(height - 2 * padY, 1) / (y1 - y0 || 1);
  const p = nodes.map((n) => ({
    ...n,
    x: x1 > x0 ? padX + (n.at.x - x0) * sx : width / 2,
    y: y1 > y0 ? padY + (y1 - n.at.y) * sy : height / 2,
  }));
  // Two ideas at one point would never part, so each starts a hair from the last.
  p.forEach((n, i) => {
    n.x += Math.cos(i * 2.4) * 0.5;
    n.y += Math.sin(i * 2.4) * 0.5;
  });
  const index = new Map(p.map((n, i) => [n.id, i]));
  const links = edges
    .map((e) => ({ p: index.get(e.a), q: index.get(e.b), s: e.similarity, out: e.out }))
    .filter(
      (e): e is { p: number; q: number; s: number; out: boolean } =>
        e.p !== undefined && e.q !== undefined,
    );

  const cx = width / 2;
  const cy = height / 2;
  // A link's length follows the frame's area, so a tall phone frame is used down its length.
  const length = Math.sqrt(width * height) * 0.42;
  const push = 2600;

  const clamp = (n: (typeof p)[number]) => {
    n.x = Math.min(Math.max(n.x, n.w / 2 + SPREAD_EDGE), width - n.w / 2 - SPREAD_EDGE);
    n.y = Math.min(Math.max(n.y, n.r + SPREAD_EDGE), height - n.h - n.r - SPREAD_EDGE);
  };

  for (let it = 0; it < iterations; it++) {
    const a = 1 - it / iterations;
    for (const e of links) {
      const m = p[e.p]!;
      const n = p[e.q]!;
      const dx = n.x - m.x;
      const dy = n.y - m.y;
      const d = Math.hypot(dx, dy) || 1;
      const rest = length * (1.55 - e.s) * (e.out ? 1.15 : 1);
      const f = (d - rest) * 0.02 * a;
      m.x += (dx / d) * f;
      m.y += (dy / d) * f;
      n.x -= (dx / d) * f;
      n.y -= (dy / d) * f;
    }
    for (let i = 0; i < p.length; i++) {
      for (let j = i + 1; j < p.length; j++) {
        const m = p[i]!;
        const n = p[j]!;
        const dx = n.x - m.x;
        const dy = n.y - m.y;
        const d = Math.hypot(dx, dy) || 0.1;
        const f = (push * a) / (d * d);
        m.x -= (dx / d) * f;
        m.y -= (dy / d) * f;
        n.x += (dx / d) * f;
        n.y += (dy / d) * f;
        separate(m, n);
      }
    }
    for (const n of p) {
      const hold = 0.002 * a * (n.core ? 1 : 0.3);
      n.x += (cx - n.x) * hold;
      n.y += (cy - n.y) * hold;
      clamp(n);
    }
  }
  // A last few passes with nothing but the boxes, so the names end apart.
  for (let pass = 0; pass < 40; pass++) {
    let moved = false;
    for (let i = 0; i < p.length; i++) {
      for (let j = i + 1; j < p.length; j++) moved = separate(p[i]!, p[j]!) || moved;
    }
    for (const n of p) clamp(n);
    if (!moved) break;
  }
  for (const n of p) out.set(n.id, { x: n.x, y: n.y });
  return out;
}

/** The box a node owns: from just above its mark down through its name. */
export function nodeBox(n: { w: number; h: number; r: number }, at: Point) {
  return { x: at.x - n.w / 2, y: at.y - n.r - 3, w: n.w, h: n.r * 2 + 5 + n.h };
}

/** Pushes two overlapping boxes apart along the shorter way out; true if they overlapped. */
function separate(
  m: { x: number; y: number; w: number; h: number; r: number },
  n: { x: number; y: number; w: number; h: number; r: number },
): boolean {
  const dx = n.x - m.x;
  const ox = (m.w + n.w) / 2 + 6 - Math.abs(dx);
  const mt = m.y - m.r - 3;
  const mb = m.y + m.r + 2 + m.h;
  const nt = n.y - n.r - 3;
  const nb = n.y + n.r + 2 + n.h;
  const oy = Math.min(mb, nb) - Math.max(mt, nt) + 4;
  if (ox <= 0 || oy <= 0) return false;
  if (ox < oy) {
    const s = ((dx >= 0 ? 1 : -1) * ox) / 2;
    m.x -= s;
    n.x += s;
  } else {
    const s = ((n.y >= m.y ? 1 : -1) * oy) / 2;
    m.y -= s;
    n.y += s;
  }
  return true;
}

/**
 * How tall the frame grows for a graph of `count` ideas, so a big place keeps
 * room for its names: never shorter than the map's own frame.
 */
export function graphHeight(width: number, count: number, base: number): number {
  const wide = width > 640;
  return Math.round(
    Math.max(base, Math.min(wide ? 1000 : 1300, (wide ? 120 : 160) + count * (wide ? 34 : 52))),
  );
}

/**
 * A name broken into lines no wider than `max` pixels, every word kept: the
 * graph names each idea in full. `measure` gives a text's width.
 */
export function wrapName(
  text: string,
  max: number,
  measure: (text: string) => number,
): { lines: string[]; width: number } {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = '';
  for (const word of words) {
    const tried = line ? `${line} ${word}` : word;
    if (line && measure(tried) > max) {
      lines.push(line);
      line = word;
    } else line = tried;
  }
  if (line) lines.push(line);
  return { lines, width: Math.max(0, ...lines.map(measure)) };
}

/**
 * Some ideas were saved under code-style names (`net_interest_margin`); the
 * graph reads them as words, so they wrap like any other name.
 */
export function readableName(name: string): string {
  if (!name.includes('_') || /\s/.test(name)) return name;
  const words = name.replace(/_+/g, ' ').trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}
