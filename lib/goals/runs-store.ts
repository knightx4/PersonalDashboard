import 'server-only';

import type { GoalsSupabaseClient } from '@/lib/goals/db/schema-name';
import { readLastLines } from '@/lib/core/run-liveness';
import { GOAL_RUNS_SHOWN, toRunListings, type RunListing, type RunRowWithItem } from '@/lib/goals/runs';

/**
 * The listings with when each run not yet ended last wrote a line (plan
 * #1825), so a stale run can say when it was last heard from and a started
 * one is read from its lines. Ended runs are not asked about.
 */
async function withLastLines(client: GoalsSupabaseClient, runs: RunListing[]): Promise<RunListing[]> {
  const going = runs.filter((run) => run.status !== 'done' && run.status !== 'failed');
  if (going.length === 0) return runs;
  let lines: Map<string, string>;
  try {
    lines = await readLastLines(
      client.schema('core') as never,
      'goals.runs',
      going.map((run) => run.id),
    );
  } catch {
    // The clock rules read the run as they did before there were lines.
    return runs;
  }
  return runs.map((run) => (lines.has(run.id) ? { ...run, lastLineAt: lines.get(run.id) ?? null } : run));
}

/**
 * Every run in goals.runs with the goal or step it was on (plan #1012),
 * newest first. Row level security keeps it to your own runs. The item comes
 * through runs_item_fk, which is (item_id, user_id), so PostgREST can embed it
 * directly. An area run's area comes the same way, through runs_area_fk.
 *
 * The cap is far past what a year of morning runs and presses writes, and
 * stops a runaway loop from making the page unreadable.
 */
const RUNS_LIMIT = 2000;

const RUN_SELECT =
  'id, job, status, created_at, ended_at, summary, error, last_seen_at, now_on, item:items!runs_item_fk(id, title, level), area:areas!runs_area_fk(id, name)';

export async function loadRuns(client: GoalsSupabaseClient): Promise<RunListing[]> {
  const { data, error } = await client
    .from('runs')
    .select(RUN_SELECT)
    .order('created_at', { ascending: false })
    .limit(RUNS_LIMIT);
  if (error) throw new Error(`Could not read runs: ${error.message}`);
  return withLastLines(client, toRunListings((data ?? []) as unknown as RunRowWithItem[]));
}

/** One run with the item it was on, for its own page (plan #1013); null when it is not yours or not there. */
export async function loadRun(client: GoalsSupabaseClient, id: string): Promise<RunListing | null> {
  const { data, error } = await client
    .from('runs')
    .select(RUN_SELECT)
    .eq('id', id)
    .maybeSingle();
  if (error) throw new Error(`Could not read the run: ${error.message}`);
  if (!data) return null;
  const [run] = await withLastLines(client, toRunListings([data as unknown as RunRowWithItem]));
  return run ?? null;
}

/**
 * The latest runs on one goal for its page (plan #1014): at most
 * GOAL_RUNS_SHOWN, and whether there are older ones on the Runs page. These
 * are the runs whose item is the goal itself, the same ones its latest-run
 * line used to read.
 */
export async function loadGoalRuns(
  client: GoalsSupabaseClient,
  goalId: string,
): Promise<{ runs: RunListing[]; more: boolean }> {
  const { data, error } = await client
    .from('runs')
    .select(RUN_SELECT)
    .eq('item_id', goalId)
    .order('created_at', { ascending: false })
    .limit(GOAL_RUNS_SHOWN + 1);
  if (error) throw new Error(`Could not read the goal's runs: ${error.message}`);
  const runs = await withLastLines(client, toRunListings((data ?? []) as unknown as RunRowWithItem[]));
  return { runs: runs.slice(0, GOAL_RUNS_SHOWN), more: runs.length > GOAL_RUNS_SHOWN };
}

/**
 * Runs that ended after `since`, for the catch-up on the Goals home after time
 * away (plan #1019). The catch-up keeps the finished ones.
 */
export async function loadRunsEndedSince(
  client: GoalsSupabaseClient,
  since: string,
): Promise<RunListing[]> {
  const { data, error } = await client
    .from('runs')
    .select(RUN_SELECT)
    .gt('ended_at', since)
    .order('ended_at', { ascending: false })
    .limit(RUNS_LIMIT);
  if (error) throw new Error(`Could not read the runs since your last visit: ${error.message}`);
  return withLastLines(client, toRunListings((data ?? []) as unknown as RunRowWithItem[]));
}

/** Runs still marked started, for the Status panel on Dash; `runOutcome` says which are really going. */
export async function loadStartedGoalRuns(client: GoalsSupabaseClient): Promise<RunListing[]> {
  const { data, error } = await client
    .from('runs')
    .select(RUN_SELECT)
    .eq('status', 'started')
    .order('created_at', { ascending: false })
    .limit(GOAL_RUNS_SHOWN);
  if (error) throw new Error(`Could not read the goal runs going: ${error.message}`);
  return withLastLines(client, toRunListings((data ?? []) as unknown as RunRowWithItem[]));
}

/**
 * Runs started after `since`, newest first, for the Goals home: who is on each
 * goal now, and when Dash last worked on it (lib/goals/hand-off.ts).
 */
export async function loadRunsStartedSince(
  client: GoalsSupabaseClient,
  since: string,
): Promise<RunListing[]> {
  const { data, error } = await client
    .from('runs')
    .select(RUN_SELECT)
    .gt('created_at', since)
    .order('created_at', { ascending: false })
    .limit(RUNS_LIMIT);
  if (error) throw new Error(`Could not read recent runs: ${error.message}`);
  return withLastLines(client, toRunListings((data ?? []) as unknown as RunRowWithItem[]));
}
