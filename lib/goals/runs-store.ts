import 'server-only';

import type { GoalsSupabaseClient } from '@/lib/goals/db/schema-name';
import { toRunListings, type RunListing, type RunRowWithItem } from '@/lib/goals/runs';

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

export async function loadRuns(client: GoalsSupabaseClient): Promise<RunListing[]> {
  const { data, error } = await client
    .from('runs')
    .select('id, job, status, created_at, ended_at, summary, error, item:items!runs_item_fk(id, title, level)')
    .order('created_at', { ascending: false })
    .limit(RUNS_LIMIT);
  if (error) throw new Error(`Could not read runs: ${error.message}`);
  return toRunListings((data ?? []) as unknown as RunRowWithItem[]);
}
