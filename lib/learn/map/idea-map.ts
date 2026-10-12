import type { KnowledgeState } from '@/lib/learn/graph/model';
import {
  cosineFromTable,
  dotTable,
  forceLayout,
  principalComponents,
  type Link,
  type Point,
  type Projection,
} from './layout';

/**
 * The Idea Space map worked out from the ideas' embeddings (plan #1855).
 *
 * Pure: the loader in `load.ts` reads the vectors and states, and this turns
 * them into what the page draws. Two layouts of the same ideas, each scaled
 * into the -1 to 1 square:
 *
 * - `pca`, the ideas projected onto their two principal components. Distances
 *   mean something across the whole map, but two flat axes keep only a small
 *   share of 1,024 dimensions, which `variance` reports.
 * - `neighbourMap`, a force layout over each idea's six nearest, started from
 *   the PCA positions. Groups of close ideas read clearly; distance between
 *   groups means little.
 *
 * And two lists for the page to show beside the map: pairs of ideas so close
 * they may be one idea twice, and ideas never tested that sit among ones you
 * know.
 */

/** How many nearest ideas each idea keeps. */
export const NEIGHBOURS_PER_IDEA = 6;
/** Two ideas this similar or more are listed as possibly the same idea. */
export const SIMILAR_PAIR_THRESHOLD = 0.86;
/** An untested idea with this many known ideas among its nearest is listed. */
export const KNOWN_NEIGHBOURS_MIN = 3;

export type IdeaVector = { id: string; vector: readonly number[]; state: KnowledgeState };

export type Neighbour = { id: string; similarity: number };

export type MapIdea = {
  id: string;
  pca: Point;
  neighbourMap: Point;
  /** The six nearest ideas, closest first, by cosine similarity. */
  neighbours: Neighbour[];
};

export type SimilarPair = { a: string; b: string; similarity: number };

export type UntestedNearKnown = {
  id: string;
  /** The known ideas among its nearest, closest first. */
  known: Neighbour[];
};

export type IdeaMap = {
  /** In order of id, which is also the order the layouts were worked out in. */
  ideas: MapIdea[];
  /** The share of variance the two components keep, from 0 to 1. */
  variance: { first: number; second: number };
  /** For placing other vectors, such as fields, on the PCA layout. */
  projection: Projection;
  /** Closest first. Each pair once, with `a` before `b` by id. */
  similarPairs: SimilarPair[];
  /** Most known neighbours first. */
  untestedNearKnown: UntestedNearKnown[];
};

/** Known well enough to count as something you hold: the same rule as `isSettled`. */
export function isKnownState(state: KnowledgeState): boolean {
  return state === 'known' || state === 'sharp';
}

/** Never shown either way: no question answered, nothing declared. */
export function isUntestedState(state: KnowledgeState): boolean {
  return state === 'unknown';
}

function byId(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Every pair's cosine similarity, as a flat n-by-n table, from their dot products. */
function similarityTable(dots: Float64Array, n: number): Float64Array {
  const table = new Float64Array(n * n);
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) table[i * n + j] = i === j ? 1 : cosineFromTable(dots, n, i, j);
  }
  return table;
}

/** Each idea's `k` nearest others, closest first, ties broken by id. */
function nearestFromTable(ids: readonly string[], table: Float64Array, k: number): Neighbour[][] {
  const n = ids.length;
  return ids.map((_, i) => {
    const others: Neighbour[] = [];
    for (let j = 0; j < n; j++) if (j !== i) others.push({ id: ids[j]!, similarity: table[i * n + j]! });
    others.sort((a, b) => b.similarity - a.similarity || byId(a.id, b.id));
    return others.slice(0, k);
  });
}

/**
 * The map for a set of ideas. Ideas are sorted by id first, so the order the
 * database returned them in changes nothing.
 */
export function buildIdeaMap(input: readonly IdeaVector[]): IdeaMap {
  const ideas = [...input].sort((a, b) => byId(a.id, b.id));
  const ids = ideas.map((idea) => idea.id);
  const index = new Map(ids.map((id, i) => [id, i]));
  const vectors = ideas.map((idea) => idea.vector);

  const dots = dotTable(vectors);
  const { points: pca, projection } = principalComponents(vectors, dots);
  const table = similarityTable(dots, ids.length);
  const neighbours = nearestFromTable(ids, table, NEIGHBOURS_PER_IDEA);

  // The neighbour graph, each link once whichever side found it.
  const linked = new Map<string, Link>();
  neighbours.forEach((list, a) => {
    for (const { id, similarity } of list) {
      const b = index.get(id)!;
      const key = a < b ? `${a}:${b}` : `${b}:${a}`;
      if (!linked.has(key)) linked.set(key, { a: Math.min(a, b), b: Math.max(a, b), weight: similarity });
    }
  });
  const neighbourMap = forceLayout(pca, [...linked.values()]);

  const n = ids.length;
  const similarPairs: SimilarPair[] = [];
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const similarity = table[i * n + j]!;
      if (similarity >= SIMILAR_PAIR_THRESHOLD) similarPairs.push({ a: ids[i]!, b: ids[j]!, similarity });
    }
  }
  similarPairs.sort((p, q) => q.similarity - p.similarity || byId(p.a, q.a) || byId(p.b, q.b));

  const untestedNearKnown: UntestedNearKnown[] = [];
  ideas.forEach((idea, i) => {
    if (!isUntestedState(idea.state)) return;
    const known = neighbours[i]!.filter(({ id }) => isKnownState(ideas[index.get(id)!]!.state));
    if (known.length >= KNOWN_NEIGHBOURS_MIN) untestedNearKnown.push({ id: idea.id, known });
  });
  const meanSimilarity = (list: Neighbour[]) => list.reduce((sum, n) => sum + n.similarity, 0) / list.length;
  untestedNearKnown.sort(
    (p, q) => q.known.length - p.known.length || meanSimilarity(q.known) - meanSimilarity(p.known) || byId(p.id, q.id),
  );

  return {
    ideas: ideas.map((idea, i) => ({
      id: idea.id,
      pca: pca[i]!,
      neighbourMap: neighbourMap[i]!,
      neighbours: neighbours[i]!,
    })),
    variance: { first: projection.variance[0], second: projection.variance[1] },
    projection,
    similarPairs,
    untestedNearKnown,
  };
}
