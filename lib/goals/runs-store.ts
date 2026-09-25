import 'server-only';

import type { GoalsSupabaseClient } from '@/lib/goals/db/schema-name';
import { GOAL_RUNS_SHOWN, toRunListings, type RunListing, type RunRowWithItem } from '@/lib/goals/runs';

/**
 * Every run in goals.runs with the goal or step it was on (plan #1012),
 * newest first. Row level security keeps it to your own runs. The item comes
 * through runs_item_fk, which is (item_id, user_id), so PostgREST can embed it
 * directly.
 *
 * The cap is far past what a year of morning runs and presses writes, and
 * stops a runaway loop from making the page unreadable.
 */
const RUNS_LIMIT = 2000;

const RUN_SELECT =
  'id, job, status, created_at, ended_at, summary, error, last_seen_at, now_on, item:items!runs_item_fk(id, title, level)';

export async function loadRuns(client: GoalsSupabaseClient): Promise<RunListing[]> {
  const { data, error } = await client
    .from('runs')
    .select(RUN_SELECT)
    .order('created_at', { ascending: false })
    .limit(RUNS_LIMIT);
  if (error) throw new Error(`Could not read runs: ${error.message}`);
  return toRunListings((data ?? []) as unknown as RunRowWithItem[]);
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
  return toRunListings([data as unknown as RunRowWithItem])[0] ?? null;
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
  const runs = toRunListings((data ?? []) as unknown as RunRowWithItem[]);
  return { runs: runs.slice(0, GOAL_RUNS_SHOWN), more: runs.length > GOAL_RUNS_SHOWN };
}
