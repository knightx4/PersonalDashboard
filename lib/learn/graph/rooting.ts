import { isSettled, readyNow, type Concept, type Graph } from '@/lib/learn/graph/model';

/**
 * What a source search is told about you.
 *
 * Two lists, read off the subject's graph. `settled` is what may be assumed;
 * `frontier` is where you actually are -- the unsettled claims with nothing
 * unsettled underneath them, which is the same rule the subject screen uses
 * for "start here".
 *
 * Pure, and separate from the call that uses it, because the honest half of
 * this is knowing when there is nothing to say. A graph with nothing settled
 * roots nothing, and the screen has to say so rather than implying a search
 * knew where you were.
 */

/** How many claims of each kind go in a prompt before it stops being read. */
export const MAX_SETTLED = 30;
export const MAX_FRONTIER = 8;

export type Rooting = {
  /** Claims the graph counts as known. What a source may assume. */
  settled: string[];
  /** Claims you could take on next. Where the reading is aimed. */
  frontier: string[];
  /** Settled claims beyond `settled`, dropped to keep the prompt readable. */
  settledOmitted: number;
};

/** Nothing is settled, so nothing can be rooted in it. */
export function isRooted(rooting: Rooting): boolean {
  return rooting.settled.length > 0;
}

/**
 * Read a subject's graph into the two lists.
 *
 * `aimConceptId` is the claim the reading is already about. It is left out of
 * the frontier -- it is the thing being read about, and listing it as
 * somewhere you could start reads as the search being told to aim at it twice.
 */
export function rootingFor(graph: Graph, aimConceptId: string | null): Rooting {
  const settledClaims: string[] = [];
  const unsettled: string[] = [];

  for (const concept of graph.concepts) {
    if (isSettled(concept)) settledClaims.push(concept.claim);
    else unsettled.push(concept.id);
  }

  const frontier = readyNow(graph, unsettled)
    .filter((concept: Concept) => concept.id !== aimConceptId)
    .slice(0, MAX_FRONTIER)
    .map((concept) => concept.claim);

  return {
    settled: settledClaims.slice(0, MAX_SETTLED),
    frontier,
    settledOmitted: Math.max(0, settledClaims.length - MAX_SETTLED),
  };
}
