/**
 * Grouping ideas into places (plan #1997.2).
 *
 * A place is a handful of ideas that sit close together on Idea Space, such
 * as "Chip shortages and the bullwhip": a landmark between the ten domains
 * and the single ideas. Places come from clustering the stored idea
 * embeddings, and this file is that clustering, pure so it can be tested.
 *
 * The method is agglomerative clustering on cosine distance with average
 * linkage: every idea starts alone, and the two closest groups are joined
 * again and again, the distance between two groups being the mean distance
 * between their ideas. That gives a tree of joins, and the places are read
 * off it from the top:
 *
 * - a join made at a distance above PLACE_MAX_DISTANCE is too loose to be a
 *   place, so its two halves are looked at instead;
 * - a group of more than PLACE_MAX ideas splits into the two groups it was
 *   joined from, which are the two closest halves it has;
 * - a group that passes both and has at least PLACE_MIN ideas is a place;
 *   a smaller one leaves its ideas in no place.
 *
 * The joins are found by the nearest-neighbour chain, which takes time and
 * memory in the square of the number of ideas: well under a second at the
 * 400 ideas held today, and a table of 200 MB at 5,000.
 */

/** The fewest ideas a place holds. Fewer stay ungrouped. */
export const PLACE_MIN = 4;

/** The most ideas a place holds. A bigger group splits. */
export const PLACE_MAX = 25;

/**
 * The loosest join that still makes a place, as a mean cosine distance
 * between its ideas (0.44 is a mean similarity of 0.56).
 *
 * Set against the 386 ideas held on 13 October 2026, whose joins were worked
 * out in the database: 0.44 gives 35 places holding 277 ideas with 109 in
 * none, close to the 33 places and 108 ungrouped of the Idea Space Places
 * mock. 0.40 left 164 ideas in no place and 0.48 left 74. The mean
 * similarity between any two of those ideas is 0.37.
 */
export const PLACE_MAX_DISTANCE = 0.44;

/** One join of the tree: the groups holding ideas `a` and `b`, at `distance`. */
export type Join = { a: number; b: number; distance: number };

export type PlaceOptions = { min?: number; max?: number; maxDistance?: number };

export type Clustering = {
  /** Each place's ideas, sorted by id; places biggest first, then by first id. */
  places: string[][];
  /** Ideas in no place, sorted by id. */
  ungrouped: string[];
};

function byId(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function unit(vector: readonly number[]): Float64Array {
  let norm = 0;
  for (const value of vector) norm += value * value;
  norm = Math.sqrt(norm) || 1;
  const out = new Float64Array(vector.length);
  for (let i = 0; i < vector.length; i++) out[i] = vector[i]! / norm;
  return out;
}

/** Every pair's cosine distance, as a flat n-by-n table. */
export function cosineDistances(vectors: readonly (readonly number[])[]): Float64Array {
  const n = vectors.length;
  const units = vectors.map(unit);
  const table = new Float64Array(n * n);
  for (let i = 0; i < n; i++) {
    const u = units[i]!;
    for (let j = i + 1; j < n; j++) {
      const v = units[j]!;
      let dot = 0;
      for (let k = 0; k < u.length; k++) dot += u[k]! * v[k]!;
      const distance = Math.max(0, 1 - dot);
      table[i * n + j] = distance;
      table[j * n + i] = distance;
    }
  }
  return table;
}

/**
 * The joins of average-linkage clustering over a distance table, closest
 * first, by the nearest-neighbour chain. The table is used as working space
 * and overwritten, so it is not copied at the size it can reach.
 *
 * Each join names one idea from either side, so the joins can be replayed in
 * order with a union-find whatever slot the chain kept each group in.
 */
export function averageLinkage(distances: Float64Array, n: number): Join[] {
  const d = distances;
  const size = new Array<number>(n).fill(1);
  const active = new Array<boolean>(n).fill(true);
  const chain: number[] = [];
  const joins: Join[] = [];
  let remaining = n;

  while (remaining > 1) {
    if (chain.length === 0) chain.push(active.indexOf(true));
    const a = chain[chain.length - 1]!;
    const previous = chain.length > 1 ? chain[chain.length - 2]! : -1;

    // The nearest active group, keeping the previous link on a tie so the
    // chain always ends.
    let b = previous;
    let best = previous >= 0 ? d[a * n + previous]! : Infinity;
    for (let k = 0; k < n; k++) {
      if (!active[k] || k === a) continue;
      const distance = d[a * n + k]!;
      if (distance < best) {
        best = distance;
        b = k;
      }
    }

    if (b !== previous) {
      chain.push(b);
      continue;
    }

    chain.pop();
    chain.pop();
    joins.push({ a, b, distance: best });
    const sa = size[a]!;
    const sb = size[b]!;
    for (let k = 0; k < n; k++) {
      if (!active[k] || k === a || k === b) continue;
      const joined = (sa * d[a * n + k]! + sb * d[b * n + k]!) / (sa + sb);
      d[a * n + k] = joined;
      d[k * n + a] = joined;
    }
    size[a] = sa + sb;
    active[b] = false;
    remaining--;
  }

  // Average linkage never joins closer than an earlier join inside either
  // side, so sorting by distance gives an order the tree can be built in.
  return joins
    .map((join, order) => ({ join, order }))
    .sort((p, q) => p.join.distance - q.join.distance || p.order - q.order)
    .map(({ join }) => join);
}

type Node = { size: number; distance: number; left: number; right: number };

/**
 * The places read off a tree of joins over `n` ideas, as lists of idea
 * indices. See the file comment for the rules.
 */
export function cutJoins(joins: readonly Join[], n: number, options: PlaceOptions = {}): { places: number[][]; ungrouped: number[] } {
  const min = options.min ?? PLACE_MIN;
  const max = options.max ?? PLACE_MAX;
  const maxDistance = options.maxDistance ?? PLACE_MAX_DISTANCE;

  // Leaves are 0..n-1, joins n.., and a union-find over the ideas names the
  // node each idea's group is at.
  const nodes: Node[] = Array.from({ length: n }, () => ({ size: 1, distance: 0, left: -1, right: -1 }));
  const parent = Array.from({ length: n }, (_, i) => i);
  const nodeOf = Array.from({ length: n }, (_, i) => i);
  const find = (i: number): number => {
    while (parent[i] !== i) {
      parent[i] = parent[parent[i]!]!;
      i = parent[i]!;
    }
    return i;
  };
  const isChild = new Set<number>();
  for (const join of joins) {
    const ra = find(join.a);
    const rb = find(join.b);
    if (ra === rb) continue;
    const left = nodeOf[ra]!;
    const right = nodeOf[rb]!;
    nodes.push({ size: nodes[left]!.size + nodes[right]!.size, distance: join.distance, left, right });
    isChild.add(left);
    isChild.add(right);
    parent[rb] = ra;
    nodeOf[ra] = nodes.length - 1;
  }

  const leavesOf = (node: number): number[] => {
    const out: number[] = [];
    const stack = [node];
    while (stack.length > 0) {
      const at = stack.pop()!;
      const { left, right } = nodes[at]!;
      if (left < 0) out.push(at);
      else stack.push(left, right);
    }
    return out;
  };

  const places: number[][] = [];
  const ungrouped: number[] = [];
  const stack: number[] = [];
  for (let i = 0; i < nodes.length; i++) if (!isChild.has(i)) stack.push(i);
  while (stack.length > 0) {
    const at = stack.pop()!;
    const node = nodes[at]!;
    if (node.left < 0) {
      ungrouped.push(at);
    } else if (node.size <= max && node.distance <= maxDistance) {
      if (node.size >= min) places.push(leavesOf(at));
      else ungrouped.push(...leavesOf(at));
    } else {
      stack.push(node.left, node.right);
    }
  }
  return { places, ungrouped };
}

/**
 * The places for a set of ideas. Ideas are sorted by id first, so the order
 * they were read in changes nothing.
 */
export function clusterPlaces(
  input: readonly { id: string; vector: readonly number[] }[],
  options: PlaceOptions = {},
): Clustering {
  const ideas = [...input].sort((a, b) => byId(a.id, b.id));
  const n = ideas.length;
  if (n === 0) return { places: [], ungrouped: [] };
  const joins = averageLinkage(
    cosineDistances(ideas.map((idea) => idea.vector)),
    n,
  );
  const cut = cutJoins(joins, n, options);
  const ids = (indices: number[]) => indices.map((i) => ideas[i]!.id).sort(byId);
  const places = cut.places
    .map(ids)
    .sort((p, q) => q.length - p.length || byId(p[0]!, q[0]!));
  return { places, ungrouped: ids(cut.ungrouped) };
}
