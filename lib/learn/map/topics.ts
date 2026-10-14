import { topicStates, type TopicIdea, type TopicLink, type TopicNode } from '@/lib/learn/evidence/topic-state';
import type { StrengthInput } from '@/lib/learn/strength';
import type { Point } from './layout';
import { IDEA_NAMES_FROM, overlaps, placeNames, type Box, type NameCandidate, type PlacedName } from './sky';

/**
 * Wikipedia's topics as the frame of Idea Space (plan #2016.5).
 *
 * Every Level 3 topic is a landmark on the map, and a Level 4 topic appears
 * once your notes, courses, work or ideas touch it (#2016.3); a hidden one is
 * not drawn. Each topic's state is #2016.4's `topicStates`.
 *
 * Where a topic sits. A topic is drawn where its ideas are: the middle of the
 * ideas attached to it (#2016.2), and for a Level 3 topic the ideas of its
 * Level 4 topics too, so ideas sit inside Level 4 topics and those inside
 * Level 3 ones. A topic with no idea of yours under it goes beside the
 * nearest thing that is placed: a Level 3 topic in a small spiral round its
 * field (the field is placed from its embedding, lib/learn/map/area-map.ts),
 * a Level 4 topic round its Level 3 parent. Placing a thousand topics from
 * their own vectors would mean reading and comparing them on every visit,
 * which measured six seconds; this costs nothing.
 *
 * Names. No screen names more than MAX_TOPIC_NAMES topics at one level,
 * strongest first. Zoomed out the Level 3 names show; from LEVEL4_FROM the
 * Level 4 topics are drawn and named too, and a Level 3 name whose unlocked
 * topics are not all named says how many more ("+23 more"), which opens on
 * zoom: pressing it flies in, where the topics in view are named instead.
 */

/** How many topics at one level a screen names at most. */
export const MAX_TOPIC_NAMES = 7;
/** Closer in, the Level 3 names kept beside the Level 4 ones, so the screen stays near seven names. */
export const LEVEL3_NAMES_INSIDE = 2;
/** The room kept between a topic's name and any other name, in pixels. */
export const NAME_PAD = 5;
/** The zoom, as a multiple of the whole-map scale, from which Level 4 topics are drawn and named. */
export const LEVEL4_FROM = 1.6;
/** The step of the spiral topics are laid in round a field or a parent, in layout units. */
export const SPIRAL_UNIT = 0.035;

export type TopicOnMap = {
  id: string;
  title: string;
  level: 3 | 4;
  /** A Level 4 topic's Level 3 parent. */
  parentId: string | null;
  state: 'unlocked' | 'lit';
  /** 0 to 1; 0 unless lit. */
  strength: number;
  /** Lit by evidence alone, so held at or below recognised. */
  evidenceOnly: boolean;
  /** Something of yours touches it. A Level 3 topic can be unlocked with nothing touching it. */
  touched: boolean;
  ideaCount: number;
  linkCount: number;
  /** The ideas on the map under it; a Level 3 topic's include its Level 4 topics' ideas. */
  ideaIds: string[];
  /** For a Level 3 topic, how many of its Level 4 topics are drawn. */
  childCount: number;
  pca: Point;
  neighbourMap: Point;
};

export type TopicCounts = {
  /** Topics at either level lit by the ideas or evidence beneath them. */
  lit: number;
  /** Topics something touches that are not lit. */
  unlocked: number;
  /** Level 3 topics nothing touches yet, drawn as faint landmarks. */
  untouched: number;
  /** Level 4 topics nothing touches, so not drawn. */
  hidden: number;
};

export type TopicFrame = { topics: TopicOnMap[]; counts: TopicCounts };

/** The rows the frame is built from (topics-load.ts reads them). */
export type TopicRows = {
  level3: { id: string; title: string; field_id: string | null }[];
  /** Only the Level 4 topics something touches; the rest are hidden by definition. */
  level4: { id: string; title: string; parent_id: string | null }[];
  /** Every Level 4 topic in the catalogue, touched or not. */
  level4Total: number;
  /** Which topic each idea sits under. */
  parents: { concept_id: string; topic_id: string }[];
  /** The evidence links written to topics. */
  links: {
    target_id: string;
    weight: number;
    similarity: number;
    found_at: string;
    matched_by: 'name' | 'similarity' | null;
  }[];
};

type Placed = { pca: Point; neighbourMap: Point };
type IdeaIn = Placed & { id: string; stateRow: StrengthInput | null };

const GOLDEN = Math.PI * (3 - Math.sqrt(5));

/** A number from 0 to 1 fixed by a string, so a topic lands in the same spot on every visit. */
function unitHash(text: string, salt: number): number {
  let h = 2166136261 ^ salt;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return ((h >>> 0) % 10007) / 10007;
}

/**
 * The i-th spot round `at`: a sunflower spiral, so the topics share the
 * ground evenly, loosened by a nudge fixed by the topic's id so they read
 * as scattered landmarks rather than a lattice.
 */
export function spiralAt(at: Point, i: number, id = '', unit = SPIRAL_UNIT): Point {
  const r = unit * Math.sqrt(i + 0.2 + 0.8 * unitHash(id, 1));
  const a = i * GOLDEN + (unitHash(id, 2) - 0.5) * 1.6;
  return { x: at.x + r * Math.cos(a), y: at.y + r * Math.sin(a) };
}

function meanOf(points: readonly Placed[]): Placed {
  const n = points.length;
  const sum = (pick: (p: Placed) => Point, axis: 'x' | 'y') => points.reduce((s, p) => s + pick(p)[axis], 0) / n;
  return {
    pca: { x: sum((p) => p.pca, 'x'), y: sum((p) => p.pca, 'y') },
    neighbourMap: { x: sum((p) => p.neighbourMap, 'x'), y: sum((p) => p.neighbourMap, 'y') },
  };
}

function spiralRound(at: Placed, i: number, id: string): Placed {
  return { pca: spiralAt(at.pca, i, id), neighbourMap: spiralAt(at.neighbourMap, i, id) };
}

/**
 * Every Level 3 topic and every Level 4 topic something touches, placed and
 * given its state on `on`. A topic with nowhere to go (no idea of yours, and
 * no field or parent on the map) is left off and counted with its state.
 */
export function buildTopicFrame(
  rows: TopicRows,
  ideas: readonly IdeaIn[],
  fields: readonly (Placed & { id: string })[],
  on: Date,
): TopicFrame {
  const ideaOf = new Map(ideas.map((idea) => [idea.id, idea]));
  const fieldAt = new Map(fields.map((field) => [field.id, field]));

  const nodes: TopicNode[] = [
    ...rows.level3.map((r) => ({ id: r.id, level: 3 as const, parentId: null })),
    ...rows.level4.map((r) => ({ id: r.id, level: 4 as const, parentId: r.parent_id })),
  ];
  const topicIdeas: TopicIdea[] = rows.parents.map((p) => ({
    id: p.concept_id,
    topicId: p.topic_id,
    state: ideaOf.get(p.concept_id)?.stateRow ?? null,
  }));
  const linksByTopic = new Map<string, TopicLink[]>();
  for (const r of rows.links) {
    const list = linksByTopic.get(r.target_id) ?? [];
    list.push({ weight: r.weight, similarity: r.similarity, foundAt: r.found_at, matchedBy: r.matched_by });
    linksByTopic.set(r.target_id, list);
  }
  const states = topicStates(nodes, topicIdeas, linksByTopic, on);

  // The ideas on the map under each topic, a Level 3 topic taking its Level 4 topics' too.
  const parentOf = new Map(rows.level4.map((r) => [r.id, r.parent_id]));
  const under = new Map<string, string[]>();
  const add = (topicId: string, ideaId: string) => {
    const list = under.get(topicId) ?? [];
    list.push(ideaId);
    under.set(topicId, list);
  };
  for (const p of rows.parents) {
    if (!ideaOf.has(p.concept_id)) continue;
    add(p.topic_id, p.concept_id);
    const parent = parentOf.get(p.topic_id);
    if (parent) add(parent, p.concept_id);
  }
  const placeOfIdeas = (id: string): Placed | null => {
    const list = under.get(id);
    return list && list.length > 0 ? meanOf(list.map((ideaId) => ideaOf.get(ideaId)!)) : null;
  };

  const counts: TopicCounts = { lit: 0, unlocked: 0, untouched: 0, hidden: 0 };
  const out: TopicOnMap[] = [];
  const level3At = new Map<string, Placed>();
  const spiralNext = new Map<string, number>();
  const nextIn = (key: string) => {
    const i = spiralNext.get(key) ?? 0;
    spiralNext.set(key, i + 1);
    return i;
  };

  const make = (id: string, title: string, level: 3 | 4, parentId: string | null, at: Placed): TopicOnMap => {
    const s = states.get(id)!;
    return {
      id,
      title,
      level,
      parentId,
      state: s.state === 'lit' ? 'lit' : 'unlocked',
      strength: s.strength,
      evidenceOnly: s.evidenceOnly,
      touched: s.ideaCount > 0 || s.linkCount > 0,
      ideaCount: s.ideaCount,
      linkCount: s.linkCount,
      ideaIds: under.get(id) ?? [],
      childCount: 0,
      ...at,
    };
  };
  const count = (t: Pick<TopicOnMap, 'state' | 'touched'>) => {
    if (t.state === 'lit') counts.lit += 1;
    else if (t.touched) counts.unlocked += 1;
    else counts.untouched += 1;
  };

  // Level 3, in order of id so each spiral is the same on every visit.
  for (const r of [...rows.level3].sort((a, b) => (a.id < b.id ? -1 : 1))) {
    const s = states.get(r.id)!;
    const touched = s.ideaCount > 0 || s.linkCount > 0;
    let at = placeOfIdeas(r.id);
    if (!at && r.field_id && fieldAt.has(r.field_id)) at = spiralRound(fieldAt.get(r.field_id)!, nextIn(r.field_id), r.id);
    if (!at) {
      count({ state: s.state === 'lit' ? 'lit' : 'unlocked', touched });
      continue;
    }
    level3At.set(r.id, at);
    const topic = make(r.id, r.title, 3, null, at);
    count(topic);
    out.push(topic);
  }

  // Level 4: only what something touches is drawn.
  const byParent = new Map<string, number>();
  for (const r of [...rows.level4].sort((a, b) => (a.id < b.id ? -1 : 1))) {
    const s = states.get(r.id)!;
    if (s.state === 'hidden') continue;
    let at = placeOfIdeas(r.id);
    if (!at && r.parent_id && level3At.has(r.parent_id)) {
      // Round its parent, starting a little way out so it does not sit on the parent's mark.
      at = spiralRound(level3At.get(r.parent_id)!, 3 + nextIn(`p:${r.parent_id}`), r.id);
    }
    const topic = make(r.id, r.title, 4, r.parent_id, at ?? { pca: { x: 0, y: 0 }, neighbourMap: { x: 0, y: 0 } });
    count(topic);
    if (!at) continue;
    out.push(topic);
    if (r.parent_id) byParent.set(r.parent_id, (byParent.get(r.parent_id) ?? 0) + 1);
  }
  const drawnLevel4 = rows.level4.filter((r) => states.get(r.id)?.state !== 'hidden').length;
  counts.hidden = Math.max(0, rows.level4Total - drawnLevel4);

  for (const topic of out) if (topic.level === 3) topic.childCount = byParent.get(topic.id) ?? 0;
  return { topics: out, counts };
}

// -- Names -------------------------------------------------------------------------

export type TopicTier = 0 | 1 | 2;

/**
 * Which topics a zoom shows. 0, the whole map: Level 3 named. 1, closer:
 * Level 4 drawn and named too. 2, close enough for ideas' names: Level 4 named,
 * Level 3 left to the ideas.
 */
export function topicTier(zoom: number): TopicTier {
  return zoom < LEVEL4_FROM ? 0 : zoom < IDEA_NAMES_FROM ? 1 : 2;
}

/** Strongest first: lit by strength, then touched by how much touches it, then landmarks. */
export function topicPriority(topic: Pick<TopicOnMap, 'state' | 'strength' | 'touched' | 'ideaCount' | 'linkCount'>): number {
  const touches = Math.min(topic.ideaCount + topic.linkCount, 99) / 100;
  if (topic.state === 'lit') return 2 + topic.strength + touches;
  return topic.touched ? 1 + touches : 0;
}

/** The text that says how many of a Level 3 topic's topics are not named. */
export function moreText(n: number): string {
  return `+${n} more`;
}

export type TopicNamesInput<T extends TopicOnMap> = {
  topics: readonly T[];
  tier: TopicTier;
  /** Where a topic is on the screen, or null when it is out of view. */
  at: (topic: T) => Point | null;
  width: number;
  height: number;
  lineHeight: number;
  measure: (topic: T | string, level: 3 | 4 | 'more') => number;
  /** The gap left between a Level 4 topic's mark and its name, in pixels. */
  gap: number;
  taken?: readonly Box[];
  covers?: (box: Box) => boolean;
  /** A topic named before any other: the one the map was last flown into. */
  first?: string | null;
};

export type TopicNames = {
  level3: PlacedName[];
  level4: PlacedName[];
  /** "+23 more" under a Level 3 name, `id` its topic's. */
  more: PlacedName[];
};

/**
 * The topic names a screen shows: at most MAX_TOPIC_NAMES at each level,
 * strongest first, none over another name or a star.
 */
export function nameTopics<T extends TopicOnMap>(input: TopicNamesInput<T>): TopicNames {
  const { topics, tier, at, width, height, lineHeight, measure, gap, covers, first } = input;
  // Other names keep a little room round them, so two never read as one label.
  const pad = (b: Box): Box => ({ x: b.x - NAME_PAD, y: b.y - NAME_PAD, w: b.w + 2 * NAME_PAD, h: b.h + 2 * NAME_PAD });
  const taken: Box[] = (input.taken ?? []).map(pad);
  const candidates = (level: 3 | 4): NameCandidate[] => {
    const out: NameCandidate[] = [];
    for (const topic of topics) {
      if (topic.level !== level) continue;
      const p = at(topic);
      if (!p || p.x < 0 || p.y < 0 || p.x > width || p.y > height) continue;
      out.push({
        id: topic.id,
        text: level === 3 ? topic.title.toUpperCase() : topic.title,
        at: p,
        priority: topicPriority(topic) + (topic.id === first ? 10 : 0),
        width: measure(topic, level),
        gap,
        wide: level === 3,
      });
    }
    return out;
  };

  const most3 = tier === 0 ? MAX_TOPIC_NAMES : LEVEL3_NAMES_INSIDE;
  const level3 = tier < 2 ? placeNames(candidates(3), width, height, lineHeight, taken, most3, covers) : [];
  // The topic the map was flown into is named even where every spot beside
  // it is over a star: its name is what says where you are.
  if (first && tier < 2 && !level3.some((p) => p.id === first)) {
    const wanted = candidates(3).filter((c) => c.id === first);
    const placed = placeNames(wanted, width, height, lineHeight, [...taken, ...level3.map((p) => pad(p.box))], 1);
    if (placed.length > 0) level3.unshift(...placed);
    if (level3.length > most3) level3.pop();
  }
  const level3Boxes = level3.map((p) => pad(p.box));
  taken.push(...level3Boxes);
  const level4 = tier > 0 ? placeNames(candidates(4), width, height, lineHeight, taken, MAX_TOPIC_NAMES, covers) : [];
  taken.push(...level4.map((p) => pad(p.box)));

  const more: PlacedName[] = [];
  if (tier === 1) {
    const named = new Map<string, number>();
    const parentOf = new Map(topics.filter((t) => t.level === 4).map((t) => [t.id, t.parentId]));
    for (const p of level4) {
      const parent = parentOf.get(p.id);
      if (parent) named.set(parent, (named.get(parent) ?? 0) + 1);
    }
    const byId = new Map(topics.map((t) => [t.id, t]));
    const own = new Map(level3.map((p, i) => [p.id, level3Boxes[i]]));
    for (const p of level3) {
      const folded = (byId.get(p.id)?.childCount ?? 0) - (named.get(p.id) ?? 0);
      if (folded <= 0) continue;
      const text = moreText(folded);
      const w = measure(text, 'more');
      // Under the name, else after it on its line, else before it.
      const tries: Box[] = [
        { x: p.box.x + (p.box.w - w) / 2, y: p.box.y + p.box.h, w, h: lineHeight - 2 },
        { x: p.box.x + p.box.w + 4, y: p.box.y + 1, w, h: lineHeight - 2 },
        { x: p.box.x - w - 4, y: p.box.y + 1, w, h: lineHeight - 2 },
      ];
      const box = tries.find(
        (b) =>
          b.x >= 2 &&
          b.x + w <= width - 2 &&
          b.y >= 2 &&
          b.y + b.h <= height - 2 &&
          !taken.some((other) => other !== own.get(p.id) && overlaps(b, other)) &&
          !covers?.(b),
      );
      if (!box) continue;
      taken.push(box);
      more.push({ id: p.id, text, box });
    }
  }
  return { level3, level4, more };
}
