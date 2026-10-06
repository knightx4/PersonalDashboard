import { score } from '@/lib/search/score';
import { PER_SOURCE_LIMIT, TOTAL_LIMIT, type SearchHit } from '@/lib/search/sources';
import type { ModuleId } from '@/lib/modules';

/**
 * The order the palette shows things in.
 *
 * Its own file because both sides run it: the server ranks what the five
 * sources returned for one query, and the browser ranks the whole list it
 * holds against every keystroke. Two copies of these rules would mean the
 * palette ordering a company differently depending on which half answered,
 * which nobody could see the reason for.
 *
 * Pure, and no `server-only`.
 */

/**
 * How well one hit matches the query, or null when it does not.
 *
 * The title, and whatever else the source said this is looked for by -- a
 * role's company, say. Never the subtitle: those are words like "Company ·
 * Job search", and matching them makes nearly every query match nearly every
 * row.
 */
export function hitPoints(hit: SearchHit, query: string): number | null {
  const points = Math.max(
    score(hit.title, query) ?? -1,
    hit.match ? (score(`${hit.title} ${hit.match}`, query) ?? -1) - 1 : -1,
  );
  return points >= 0 ? points : null;
}

/**
 * Two lists already ranked best first, merged into one on their points.
 *
 * The palette's two halves (plan #1618): the places you can go and the things
 * you own are each ranked against the query, and this puts them in one order.
 * On equal points the first list's row goes first, and each list keeps its
 * own order, so a list ranked by its own tie-breaks stays that way.
 */
export function mergeRanked<A, B>(
  first: readonly { item: A; points: number }[],
  second: readonly { item: B; points: number }[],
): (A | B)[] {
  const merged: (A | B)[] = [];
  let i = 0;
  let j = 0;
  while (i < first.length || j < second.length) {
    if (j >= second.length || (i < first.length && first[i].points >= second[j].points)) {
      merged.push(first[i].item);
      i += 1;
    } else {
      merged.push(second[j].item);
      j += 1;
    }
  }
  return merged;
}

/** Ranked against the query, best first, then alphabetically for stability. */
export function rankHits(hits: SearchHit[], query: string): SearchHit[] {
  return hits
    .map((hit) => ({ hit, points: hitPoints(hit, query) ?? -1 }))
    .filter((scored) => scored.points >= 0)
    .sort(
      (a, b) => b.points - a.points || a.hit.title.localeCompare(b.hit.title),
    )
    .map((scored) => scored.hit);
}

/**
 * Ranked, then capped: so many from any one workspace, and so many overall.
 *
 * The per-workspace cap is what stops four hundred orders filling a list meant
 * to be read at a glance. It is per workspace rather than per kind because
 * that is what the server has always done -- a workspace is a source, and a
 * source has always been capped as a whole.
 */
export function paletteHits(
  hits: SearchHit[],
  query: string,
  limits: { perModule?: number; total?: number } = {},
): SearchHit[] {
  const perModule = limits.perModule ?? PER_SOURCE_LIMIT;
  const total = limits.total ?? TOTAL_LIMIT;

  const taken = new Map<ModuleId, number>();
  const kept: SearchHit[] = [];

  for (const hit of rankHits(hits, query)) {
    const already = taken.get(hit.module) ?? 0;
    if (already >= perModule) continue;
    taken.set(hit.module, already + 1);
    kept.push(hit);
    if (kept.length >= total) break;
  }

  return kept;
}
