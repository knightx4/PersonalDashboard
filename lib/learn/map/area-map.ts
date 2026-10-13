import { buildIdeaMap, NEIGHBOURS_PER_IDEA, type IdeaMap, type IdeaVector } from './idea-map';
import { cosine, principalComponents, project, type Point } from './layout';

/**
 * Where the area catalogue's fields and domains sit on the Idea Space map
 * (plan #1856).
 *
 * Pure, like `idea-map.ts`. A field is the area's own description, so it is
 * placed whether or not any of your ideas are in it: an empty patch of the
 * map with a field name on it is a part you have not been to.
 *
 * - `pca`: the field's vector projected onto the ideas' two principal
 *   components, in the ideas' frame (`project`). A field far from every idea
 *   can land outside the -1 to 1 square, which is the honest answer.
 * - `neighbourMap`: the force layout has no formula for a new point, so a
 *   field goes to the similarity-weighted mean of its six nearest ideas'
 *   neighbour-map positions. Fields whose nearest ideas are the same ideas
 *   land together, which is what the layout shows for ideas too.
 * - A domain sits at the mean of its fields' positions, in each layout.
 *
 * With no ideas at all there is nothing to project onto, so the fields are
 * laid out by their own principal components (both layouts the same).
 */

export type FieldVector = { id: string; domainId: string; vector: readonly number[] };
export type DomainRef = { id: string };

export type AreaPlacement = { id: string; pca: Point; neighbourMap: Point };
export type FieldPlacement = AreaPlacement & { domainId: string };
export type DomainPlacement = AreaPlacement & {
  /** How many of the domain's fields are in the mean. */
  fields: number;
};

export type AreaMap = {
  /** In order of id. */
  fields: FieldPlacement[];
  /** In order of id. A domain with no embedded field is not placed. */
  domains: DomainPlacement[];
};

function byId(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function mean(points: readonly Point[]): Point {
  const n = points.length || 1;
  return { x: points.reduce((s, p) => s + p.x, 0) / n, y: points.reduce((s, p) => s + p.y, 0) / n };
}

/** The point the six nearest ideas pull a vector to, weighted by similarity. */
function weightedNearest(
  vector: readonly number[],
  ideas: readonly IdeaVector[],
  positions: ReadonlyMap<string, Point>,
): Point {
  const scored = ideas
    .map((idea) => ({ id: idea.id, similarity: cosine(vector, idea.vector) }))
    .sort((a, b) => b.similarity - a.similarity || byId(a.id, b.id))
    .slice(0, NEIGHBOURS_PER_IDEA);
  let weight = 0;
  let x = 0;
  let y = 0;
  for (const { id, similarity } of scored) {
    const w = Math.max(similarity, 0);
    const p = positions.get(id)!;
    weight += w;
    x += p.x * w;
    y += p.y * w;
  }
  if (weight > 0) return { x: x / weight, y: y / weight };
  return mean(scored.map(({ id }) => positions.get(id)!));
}

/**
 * Places `fields` and `domains` on a map already built from `ideas`. `map`
 * must be `buildIdeaMap(ideas)`; ideas and fields must share a vector width.
 */
export function placeAreas(
  ideas: readonly IdeaVector[],
  map: IdeaMap,
  fieldVectors: readonly FieldVector[],
  domains: readonly DomainRef[],
): AreaMap {
  const fields = [...fieldVectors].sort((a, b) => byId(a.id, b.id));
  let placed: FieldPlacement[];

  if (ideas.length === 0) {
    const { points } = principalComponents(fields.map((f) => f.vector));
    placed = fields.map((f, i) => ({ id: f.id, domainId: f.domainId, pca: points[i]!, neighbourMap: points[i]! }));
  } else {
    const positions = new Map(map.ideas.map((idea) => [idea.id, idea.neighbourMap]));
    placed = fields.map((f) => ({
      id: f.id,
      domainId: f.domainId,
      pca: project(f.vector, map.projection),
      neighbourMap: weightedNearest(f.vector, ideas, positions),
    }));
  }

  const domainPlacements: DomainPlacement[] = [];
  for (const domain of [...domains].sort((a, b) => byId(a.id, b.id))) {
    const own = placed.filter((f) => f.domainId === domain.id);
    if (own.length === 0) continue;
    domainPlacements.push({
      id: domain.id,
      fields: own.length,
      pca: mean(own.map((f) => f.pca)),
      neighbourMap: mean(own.map((f) => f.neighbourMap)),
    });
  }
  return { fields: placed, domains: domainPlacements };
}

/** Convenience for callers and tests with only vectors in hand. */
export function buildAreaMap(
  ideas: readonly IdeaVector[],
  fields: readonly FieldVector[],
  domains: readonly DomainRef[],
): { map: IdeaMap; areas: AreaMap } {
  const map = buildIdeaMap(ideas);
  return { map, areas: placeAreas(ideas, map, fields, domains) };
}

