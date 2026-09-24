import 'server-only';

import type { VaultSupabaseClient } from '@/lib/vault/db/schema-name';

/**
 * Score each position's centrality (plan #817).
 *
 * obsidian.score_position_centrality (supabase/migrations-vault/0019) runs
 * PageRank over position_edges and writes the result to
 * positions.centrality, which the theme page sorts on. It recomputes from the
 * live tables on every call, since merges and their undos change position
 * ids, and writes only the rows whose score changed, biggest change first,
 * until its budget is spent. This calls it until nothing is left to write or
 * the deadline passes.
 *
 * Needs the service-role client: the function is not granted to a signed-in
 * caller. `userId` null scores every owner.
 */

/** How long one database call may work, well inside PostgREST's eight seconds. */
export const CENTRALITY_CALL_BUDGET_MS = 4_000;

/**
 * The least time worth starting a call with. The PageRank alone takes about
 * a second and a half over five thousand positions, before anything is
 * written.
 */
export const CENTRALITY_MIN_CALL_MS = 3_000;

export type CentralityResult = {
  /** Positions in some owner's edge graph, scored on the last call. */
  scored: number;
  /** Rows written across every call. */
  written: number;
  /** Rows whose stored score is still out of date. */
  remaining: number;
  stopped: { reason: 'time' } | { reason: 'error'; detail: string } | null;
};

type Reply = { scored?: number; written?: number; remaining?: number };

export async function scorePositionCentrality(
  supabase: VaultSupabaseClient,
  options: { userId: string | null; deadline: number; now?: () => number },
): Promise<CentralityResult> {
  const now = options.now ?? Date.now;
  let scored = 0;
  let written = 0;
  let remaining = 0;

  for (;;) {
    const left = options.deadline - now();
    if (left < CENTRALITY_MIN_CALL_MS) return { scored, written, remaining, stopped: { reason: 'time' } };

    const { data, error } = await supabase.rpc('score_position_centrality', {
      p_user_id: options.userId,
      p_budget_ms: Math.min(CENTRALITY_CALL_BUDGET_MS, left - 1_000),
    });
    if (error) return { scored, written, remaining, stopped: { reason: 'error', detail: error.message } };

    const reply = (data ?? {}) as Reply;
    const wrote = Number(reply.written ?? 0);
    scored = Number(reply.scored ?? 0);
    written += wrote;
    remaining = Number(reply.remaining ?? 0);
    if (remaining === 0) return { scored, written, remaining, stopped: null };
    // Rows left and none written means the call had no time past the
    // PageRank; carry on next tick rather than spin.
    if (wrote === 0) return { scored, written, remaining, stopped: { reason: 'time' } };
  }
}
