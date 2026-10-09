/**
 * The daily health check of the job search (problems.ts): read how the
 * latest runs went, then keep the bell in step. A new problem is raised once
 * (public.raised_items, module 'jobs'); a problem still there leaves its raise
 * alone; one that has cleared closes its raise with a line saying so.
 *
 * Called by the daily opening upkeep (inngest/jobs/suggestions.ts) with
 * service clients, so every read and write names the person.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import type { AppSupabaseClient } from '@/lib/jobs/db/schema-name';
import { BOARD_LIMIT } from '@/lib/jobs/suggest/boards';
import { loadLatestRun, type SearchRunView } from '@/lib/jobs/suggest/search-runs';
import { HEALTH_SOURCE_PREFIX, healthProblems, healthSource, type RunFact } from './problems';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type PublicClient = SupabaseClient<any, 'public', any>;

const STALE_UNSCORED_HOURS = 36;

function fact(run: SearchRunView | null): RunFact | null {
  return run
    ? { state: run.state, startedAt: run.startedAt, boardsRead: run.boardsRead, error: run.error }
    : null;
}

export type HealthOutcome = { raised: number; closed: number; open: number };

export async function checkSearchHealth(
  jobs: AppSupabaseClient,
  pub: PublicClient,
  userId: string,
  options: { jevOn: boolean; now?: Date },
): Promise<HealthOutcome> {
  const now = options.now ?? new Date();
  const staleBefore = new Date(now.getTime() - STALE_UNSCORED_HOURS * 60 * 60 * 1000).toISOString();
  const [rolesRun, peopleRun, boards, discovery, unscored, raised] = await Promise.all([
    loadLatestRun(jobs, userId, 'apply', now),
    loadLatestRun(jobs, userId, 'reach_out', now),
    jobs
      .from('companies')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId)
      .not('ats_board_token', 'is', null)
      .or('priority.is.null,priority.neq.passed'),
    jobs
      .from('discovery_runs')
      .select('stage, started_at, offered, error')
      .eq('user_id', userId)
      .order('started_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
    jobs
      .from('suggestions')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId)
      .eq('kind', 'apply')
      .eq('status', 'open')
      .is('scored_at', null)
      .lt('created_at', staleBefore),
    pub
      .from('raised_items')
      .select('id, source')
      .eq('user_id', userId)
      .eq('status', 'open')
      .like('source', `${HEALTH_SOURCE_PREFIX}%`),
  ]);
  if (raised.error) throw new Error(`Reading the open health raises failed: ${raised.error.message}`);

  const d = discovery.data as { stage: string; started_at: string; offered: number; error: string | null } | null;
  const problems = healthProblems({
    now,
    rolesRun: fact(rolesRun),
    peopleRun: fact(peopleRun),
    followedBoards: boards.count ?? 0,
    boardLimit: BOARD_LIMIT,
    discovery: d ? { stage: d.stage, startedAt: d.started_at, offered: d.offered, error: d.error } : null,
    jevOn: options.jevOn,
    staleUnscored: unscored.count ?? 0,
  });

  const open = new Map(((raised.data ?? []) as { id: string; source: string }[]).map((row) => [row.source, row.id]));
  const outcome: HealthOutcome = { raised: 0, closed: 0, open: problems.length };
  const current = new Set<string>();
  for (const problem of problems) {
    const source = healthSource(problem.key);
    current.add(source);
    if (open.has(source)) continue;
    const { error } = await pub.from('raised_items').insert({
      user_id: userId,
      module: 'jobs',
      title: problem.title.slice(0, 200),
      detail: problem.detail.slice(0, 4000),
      source,
    });
    if (error) console.error('[jobs health] raise', error.message);
    else outcome.raised += 1;
  }
  const day = now.toISOString().slice(0, 10);
  for (const [source, id] of open) {
    if (current.has(source)) continue;
    const { error } = await pub
      .from('raised_items')
      .update({ status: 'closed', outcome: `Cleared: the daily check on ${day} found it working again.` })
      .eq('id', id)
      .eq('user_id', userId);
    if (error) console.error('[jobs health] close', error.message);
    else outcome.closed += 1;
  }
  return outcome;
}
