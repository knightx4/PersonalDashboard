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

/** Ranked against the query, best first, then alphabetically for stability. */
export function rankHits(hits: SearchHit[], query: string): SearchHit[] {
  return hits
    .map((hit) => ({
      hit,
      // The title, and whatever else the source said this is looked for by --
      // a role's company, say. Never the subtitle: those are words like
      // "Company · Job search", and matching them makes nearly every query
      // match nearly every row.
      points: Math.max(
        score(hit.title, query) ?? -1,
        hit.match ? (score(`${hit.title} ${hit.match}`, query) ?? -1) - 1 : -1,
      ),
    }))
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
