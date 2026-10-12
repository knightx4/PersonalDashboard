/**
 * The geometry behind the Idea Space map (plan #1852): vectors in, flat
 * positions out.
 *
 * Pure, and deterministic on purpose. The page works the map out again on
 * every visit rather than storing it, so the same ideas must land in the same
 * places each time, or the map would move between visits with nothing having
 * changed. Nothing here draws on Math.random: power iteration starts from a
 * fixed seed, each component's sign is fixed by a rule, and the neighbour
 * layout starts from the principal-component positions.
 *
 * Every layout is scaled into the square from -1 to 1 on both axes, keeping
 * its shape: the middle of the points' bounding box goes to the origin and the
 * longer side spans the full width. A page draws a layout by mapping that
 * square onto its own box.
 */

export type Point = { x: number; y: number };

/**
 * How raw coordinates were moved into the -1 to 1 square: subtract the
 * centre, then multiply by `scale`. Kept so something placed later, such as a
 * field's vector, can be put in the same frame as the ideas.
 */
export type Frame = { cx: number; cy: number; scale: number };

/** The two principal components of a set of vectors. */
export type Projection = {
  /** The mean vector, subtracted before projecting. */
  mean: number[];
  /** Two unit vectors, the first along the most variance. */
  components: [number[], number[]];
  /**
   * The share of the total variance each component keeps, from 0 to 1. The
   * two together say how faithful the flat picture is: at 1,024 dimensions a
   * tenth or less is usual.
   */
  variance: [number, number];
  /** How the projected coordinates were scaled into the -1 to 1 square. */
  frame: Frame;
};

const POWER_ITERATIONS = 200;
const POWER_TOLERANCE = 1e-12;

/** A fixed pseudo-random sequence (mulberry32), so every run starts the same. */
function seeded(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function dot(a: ArrayLike<number>, b: ArrayLike<number>): number {
  let sum = 0;
  for (let i = 0; i < a.length; i++) sum += a[i]! * b[i]!;
  return sum;
}

function normalise(v: Float64Array): number {
  const length = Math.sqrt(dot(v, v));
  if (length > 0) for (let i = 0; i < v.length; i++) v[i]! /= length;
  return length;
}

/** Cosine similarity, the same measure as pgvector's `1 - (a <=> b)`. */
export function cosine(a: ArrayLike<number>, b: ArrayLike<number>): number {
  const denominator = Math.sqrt(dot(a, a) * dot(b, b));
  return denominator === 0 ? 0 : dot(a, b) / denominator;
}

/**
 * Every pair's dot product, as a flat n-by-n table. This is the one pass over
 * the full 1,024 dimensions: the principal components and the cosine
 * similarities are both read from it, so a caller that needs both works it
 * out once and passes it to each.
 */
export function dotTable(vectors: readonly (readonly number[])[]): Float64Array {
  const n = vectors.length;
  const rows = vectors.map((v) => Float64Array.from(v));
  const table = new Float64Array(n * n);
  for (let i = 0; i < n; i++) {
    for (let j = i; j < n; j++) {
      const value = dot(rows[i]!, rows[j]!);
      table[i * n + j] = value;
      table[j * n + i] = value;
    }
  }
  return table;
}

/** The cosine similarity of ideas `i` and `j`, read from a `dotTable`. */
export function cosineFromTable(table: Float64Array, n: number, i: number, j: number): number {
  const denominator = Math.sqrt(table[i * n + i]! * table[j * n + j]!);
  return denominator === 0 ? 0 : table[i * n + j]! / denominator;
}

/** Takes from `v` its part along each of `basis`, which are unit vectors. */
function orthogonalise(v: Float64Array, basis: Float64Array[]): void {
  for (const b of basis) {
    const along = dot(v, b);
    for (let i = 0; i < v.length; i++) v[i]! -= along * b[i]!;
  }
}

/**
 * The leading eigenvector of the symmetric n-by-n matrix `gram`, orthogonal
 * to `found`, by power iteration from a seeded start, with its eigenvalue.
 */
function leadingEigen(gram: Float64Array, n: number, found: Float64Array[], seed: number): { u: Float64Array; value: number } {
  const random = seeded(seed);
  let u = new Float64Array(n);
  for (let i = 0; i < n; i++) u[i] = random() - 0.5;
  orthogonalise(u, found);
  if (normalise(u) === 0) return { u, value: 0 };

  let next = new Float64Array(n);
  for (let step = 0; step < POWER_ITERATIONS; step++) {
    for (let i = 0; i < n; i++) {
      let sum = 0;
      for (let j = 0; j < n; j++) sum += gram[i * n + j]! * u[j]!;
      next[i] = sum;
    }
    orthogonalise(next, found);
    if (normalise(next) === 0) return { u: next, value: 0 };
    let change = 0;
    for (let i = 0; i < n; i++) change += (next[i]! - u[i]!) ** 2;
    [u, next] = [next, u];
    if (change < POWER_TOLERANCE) break;
  }

  let value = 0;
  for (let i = 0; i < n; i++) {
    let sum = 0;
    for (let j = 0; j < n; j++) sum += gram[i * n + j]! * u[j]!;
    value += u[i]! * sum;
  }
  return { u, value: Math.max(value, 0) };
}

/**
 * Scales points into the -1 to 1 square, keeping their shape. A single point,
 * or several in one place, goes to the origin.
 */
export function fitToSquare(points: readonly Point[]): { points: Point[]; frame: Frame } {
  if (points.length === 0) return { points: [], frame: { cx: 0, cy: 0, scale: 1 } };
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const p of points) {
    minX = Math.min(minX, p.x);
    maxX = Math.max(maxX, p.x);
    minY = Math.min(minY, p.y);
    maxY = Math.max(maxY, p.y);
  }
  const half = Math.max(maxX - minX, maxY - minY) / 2;
  const frame = { cx: (minX + maxX) / 2, cy: (minY + maxY) / 2, scale: half > 0 ? 1 / half : 1 };
  return { points: points.map((p) => inFrame(p, frame)), frame };
}

/** A raw point moved into a frame worked out by `fitToSquare`. */
export function inFrame(point: Point, frame: Frame): Point {
  return { x: (point.x - frame.cx) * frame.scale, y: (point.y - frame.cy) * frame.scale };
}

/**
 * The two principal components of `vectors` and each vector's position on
 * them, scaled into the -1 to 1 square. Every vector must have the same
 * length; `dots` is their `dotTable`, worked out here when not given.
 *
 * With far fewer ideas than dimensions, the work is done on the n-by-n
 * matrix of centred dot products rather than the 1,024-by-1,024 covariance:
 * the two share their leading eigenvalues, and an idea's coordinate on a
 * component is the square root of the eigenvalue times its entry in the
 * eigenvector. Each component's sign is chosen so the sum of its entries is
 * positive, which keeps the map the same way round as ideas are added.
 */
export function principalComponents(
  vectors: readonly (readonly number[])[],
  dots: Float64Array = dotTable(vectors),
): { points: Point[]; projection: Projection } {
  const n = vectors.length;
  const dimensions = vectors[0]?.length ?? 0;
  const mean = new Array<number>(dimensions).fill(0);
  for (const v of vectors) {
    if (v.length !== dimensions) throw new Error(`Every vector must have ${dimensions} dimensions; one has ${v.length}.`);
    for (let i = 0; i < dimensions; i++) mean[i]! += v[i]! / n;
  }

  // Centring the dot products: (xi - m)·(xj - m) = xi·xj - xi·m - xj·m + m·m.
  const rowMean = new Float64Array(n);
  let allMean = 0;
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) rowMean[i]! += dots[i * n + j]! / n;
    allMean += rowMean[i]! / n;
  }
  const gram = new Float64Array(n * n);
  let total = 0;
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) gram[i * n + j] = dots[i * n + j]! - rowMean[i]! - rowMean[j]! + allMean;
    total += Math.max(gram[i * n + i]!, 0);
  }

  const first = leadingEigen(gram, n, [], 1852);
  const second = leadingEigen(gram, n, first.value > 0 ? [first.u] : [], 1855);

  const coordinates: Float64Array[] = [];
  const components: number[][] = [];
  for (const { u, value } of [first, second]) {
    const component = new Float64Array(dimensions);
    if (value > 0) {
      vectors.forEach((v, i) => {
        for (let k = 0; k < dimensions; k++) component[k]! += u[i]! * (v[k]! - mean[k]!);
      });
      normalise(component);
    }
    let sum = 0;
    for (let k = 0; k < dimensions; k++) sum += component[k]!;
    const sign = sum < 0 ? -1 : 1;
    const length = Math.sqrt(value);
    coordinates.push(Float64Array.from(u, (entry) => (value > 0 ? sign * length * entry : 0)));
    components.push(Array.from(component, (entry) => sign * entry || 0));
  }

  const variance: [number, number] = total > 0 ? [first.value / total, second.value / total] : [0, 0];
  const fitted = fitToSquare(Array.from(coordinates[0]!, (x, i) => ({ x, y: coordinates[1]![i]! })));

  return {
    points: fitted.points,
    projection: {
      mean,
      components: [components[0]!, components[1]!],
      variance,
      frame: fitted.frame,
    },
  };
}

/**
 * Where any vector of the same width lands on the principal-component map,
 * in the same frame as the ideas the projection was worked out from. A vector
 * far from all of them can land outside the -1 to 1 square.
 */
export function project(vector: readonly number[], projection: Projection): Point {
  const [first, second] = projection.components;
  let x = 0;
  let y = 0;
  for (let i = 0; i < vector.length; i++) {
    const centred = vector[i]! - projection.mean[i]!;
    x += centred * first[i]!;
    y += centred * second[i]!;
  }
  return inFrame({ x, y }, projection.frame);
}

/** One link of the neighbour graph, by index into the layout's points. */
export type Link = { a: number; b: number; weight: number };

const LAYOUT_ITERATIONS = 300;
/** Pulls every point a little towards the middle, so loose groups stay on the map. */
const GRAVITY = 0.02;

/**
 * A force layout over the neighbour graph (Fruchterman and Reingold): linked
 * ideas pull together in proportion to their similarity, every pair pushes
 * apart, and the steps shrink each round until the points settle. It starts
 * from `seeds`, the principal-component positions, so the result keeps their
 * broad arrangement and comes out the same every time.
 *
 * Every pair is compared on every round. At a few hundred ideas that is well
 * under a second; at several thousand it would want a grid.
 */
export function forceLayout(seeds: readonly Point[], links: readonly Link[]): Point[] {
  const n = seeds.length;
  if (n === 0) return [];
  if (n === 1) return [{ x: 0, y: 0 }];

  const x = Float64Array.from(seeds, (p) => p.x);
  const y = Float64Array.from(seeds, (p) => p.y);
  // Points that start in one place are parted by a fixed, tiny offset.
  for (let i = 0; i < n; i++) {
    x[i]! += Math.cos(i) * 1e-4;
    y[i]! += Math.sin(i) * 1e-4;
  }

  const ideal = 2 / Math.sqrt(n);
  const ideal2 = ideal * ideal;
  const dx = new Float64Array(n);
  const dy = new Float64Array(n);
  const startHeat = 0.1;

  for (let round = 0; round < LAYOUT_ITERATIONS; round++) {
    dx.fill(0);
    dy.fill(0);

    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const ex = x[i]! - x[j]!;
        const ey = y[i]! - y[j]!;
        const d2 = Math.max(ex * ex + ey * ey, 1e-12);
        const push = ideal2 / d2;
        dx[i]! += ex * push;
        dy[i]! += ey * push;
        dx[j]! -= ex * push;
        dy[j]! -= ey * push;
      }
    }

    for (const { a, b, weight } of links) {
      const ex = x[a]! - x[b]!;
      const ey = y[a]! - y[b]!;
      const d = Math.sqrt(ex * ex + ey * ey);
      const pull = (d / ideal) * Math.max(weight, 0);
      dx[a]! -= ex * pull;
      dy[a]! -= ey * pull;
      dx[b]! += ex * pull;
      dy[b]! += ey * pull;
    }

    const heat = startHeat * (1 - round / LAYOUT_ITERATIONS);
    for (let i = 0; i < n; i++) {
      dx[i]! -= x[i]! * GRAVITY * n * ideal;
      dy[i]! -= y[i]! * GRAVITY * n * ideal;
      const length = Math.sqrt(dx[i]! * dx[i]! + dy[i]! * dy[i]!);
      if (length === 0) continue;
      const stepLength = Math.min(length, heat);
      x[i]! += (dx[i]! / length) * stepLength;
      y[i]! += (dy[i]! / length) * stepLength;
    }
  }

  return fitToSquare(Array.from(x, (value, i) => ({ x: value, y: y[i]! }))).points;
}
