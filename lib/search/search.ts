import { score } from '@/lib/search/score';
import {
  MIN_QUERY,
  PER_SOURCE_LIMIT,
  TOTAL_LIMIT,
  type SearchHit,
  type SearchSource,
} from '@/lib/search/sources';
import type { ModuleId } from '@/lib/modules';

/**
 * Running the sources and merging what comes back.
 *
 * Pure of any client: the sources are handed in, so this file -- which holds
 * every rule about what the palette shows -- can be tested with stubs, no
 * database and no network.
 *
 * Three rules, and each one is a way the box gets ruined:
 *
 *   **A source that fails contributes nothing.** The palette must not go down
 *   because the vault's token expired. Same as the agenda's fan-out, and the
 *   same reason: your own todos have to render when somebody else's workspace
 *   is broken.
 *
 *   **A source whose module is switched off never runs.** Turning a workspace
 *   off has to mean it stops appearing, and a search that quietly still
 *   reaches into it would make that setting a lie.
 *
 *   **Caps per source and overall.** One workspace with four hundred orders
 *   would otherwise fill a list that is meant to be read at a glance.
 */

export type SearchOutcome = {
  hits: SearchHit[];
  /** Sources that ran and threw. For a log line, not for the screen. */
  failed: string[];
};

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

export async function searchEverything(input: {
  userId: string;
  query: string;
  sources: SearchSource[];
  /** Which workspaces are on. A source outside this never runs. */
  enabledModules: readonly ModuleId[];
  perSourceLimit?: number;
  totalLimit?: number;
}): Promise<SearchOutcome> {
  const query = input.query.trim();
  if (query.length < MIN_QUERY) return { hits: [], failed: [] };

  const perSource = input.perSourceLimit ?? PER_SOURCE_LIMIT;
  const total = input.totalLimit ?? TOTAL_LIMIT;

  const active = input.sources.filter((source) => input.enabledModules.includes(source.module));

  const settled = await Promise.allSettled(
    active.map((source) => source.find({ userId: input.userId, query, limit: perSource })),
  );

  const hits: SearchHit[] = [];
  const failed: string[] = [];

  settled.forEach((result, index) => {
    if (result.status === 'fulfilled') {
      // Capped again here rather than trusted: a source is a file somebody
      // else writes, and the promise the palette makes is about the list.
      hits.push(...result.value.slice(0, perSource));
    } else {
      failed.push(active[index].label);
    }
  });

  return { hits: rankHits(hits, query).slice(0, total), failed };
}
