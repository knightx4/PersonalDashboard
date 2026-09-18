import { paletteHits } from '@/lib/search/rank';
import {
  LIST_LIMIT,
  MIN_QUERY,
  PER_SOURCE_LIMIT,
  TOTAL_LIMIT,
  type HitKind,
  type SearchHit,
  type SearchSource,
} from '@/lib/search/sources';
import type { ModuleId } from '@/lib/modules';

/**
 * Running the sources and merging what comes back.
 *
 * Pure of any client: the sources are handed in, so this file can be tested
 * with stubs, no database and no network. The order and the caps live next
 * door in rank.ts, because the browser applies the same ones to the list it
 * holds.
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
 *   **Caps per source and overall**, from rank.ts. One workspace with four
 *   hundred orders would otherwise fill a list that is meant to be read at a
 *   glance.
 *
 *   **A caller may ask for only some kinds.** The palette wants everything;
 *   the todo link picker wants only what a task can be about. Narrowing here
 *   rather than in the caller means a source that could not contribute a
 *   wanted kind is never asked, and the caps are spent on rows that can
 *   actually be chosen -- filtering afterwards would leave a picker empty on a
 *   workspace full of the wrong kind of thing.
 */

export type SearchOutcome = {
  hits: SearchHit[];
  /** Sources that ran and threw. For a log line, not for the screen. */
  failed: string[];
};

export async function searchEverything(input: {
  userId: string;
  query: string;
  sources: SearchSource[];
  /** Which workspaces are on. A source outside this never runs. */
  enabledModules: readonly ModuleId[];
  /** Only these kinds. Left out means every kind, which is the palette. */
  kinds?: readonly HitKind[];
  perSourceLimit?: number;
  totalLimit?: number;
}): Promise<SearchOutcome> {
  const query = input.query.trim();
  if (query.length < MIN_QUERY) return { hits: [], failed: [] };

  const perSource = input.perSourceLimit ?? PER_SOURCE_LIMIT;
  const total = input.totalLimit ?? TOTAL_LIMIT;
  const wanted = input.kinds;

  const active = input.sources.filter(
    (source) =>
      input.enabledModules.includes(source.module) &&
      (!wanted || source.kinds.some((kind) => wanted.includes(kind))),
  );

  const settled = await Promise.allSettled(
    active.map((source) => source.find({ userId: input.userId, query, limit: perSource })),
  );

  const hits: SearchHit[] = [];
  const failed: string[] = [];

  settled.forEach((result, index) => {
    if (result.status === 'fulfilled') {
      // Capped and filtered again here rather than trusted: a source is a file
      // somebody else writes, and the promise this makes is about the list. A
      // source that answers with a kind nobody asked for has it dropped.
      const answered = wanted
        ? result.value.filter((hit) => wanted.includes(hit.kind))
        : result.value;
      hits.push(...answered.slice(0, perSource));
    } else {
      failed.push(active[index].label);
    }
  });

  return { hits: paletteHits(hits, query, { perModule: perSource, total }), failed };
}

export type ListOutcome = SearchOutcome & {
  /**
   * True when the cap may have cut rows out of the list. Reported the safe way
   * round: a list that came back exactly at the cap counts as cut short, even
   * on the off chance it was the whole truth, because the caller's answer to
   * an incomplete list is to go on asking the server per keystroke.
   */
  truncated: boolean;
};

/**
 * Everything the palette can find, with no query.
 *
 * The same three rules as `searchEverything` -- a failed source contributes
 * nothing, a switched-off workspace never runs, and there is a cap -- over the
 * sources' `list` rather than their `find`. Nothing is ranked here: the
 * browser is what matches this list against what somebody types.
 */
export async function listEverything(input: {
  userId: string;
  sources: SearchSource[];
  /** Which workspaces are on. A source outside this never runs. */
  enabledModules: readonly ModuleId[];
  limit?: number;
}): Promise<ListOutcome> {
  const limit = input.limit ?? LIST_LIMIT;

  const active = input.sources.filter((source) => input.enabledModules.includes(source.module));

  const settled = await Promise.allSettled(
    active.map((source) => source.list({ userId: input.userId, limit })),
  );

  const hits: SearchHit[] = [];
  const failed: string[] = [];

  settled.forEach((result, index) => {
    if (result.status === 'fulfilled') hits.push(...result.value);
    else failed.push(active[index].label);
  });

  return { hits: hits.slice(0, limit), failed, truncated: hits.length >= limit };
}
