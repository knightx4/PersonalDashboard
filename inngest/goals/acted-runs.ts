import 'server-only';

import { flagActedRuns, type ActedRunsResult } from '@/lib/goals/acted-flags-store';
import type { GoalsSupabaseClient } from '@/lib/goals/db/schema-name';
import { createGoalsServiceSupabase } from '@/inngest/goals/supabase-admin';

/**
 * Flag each goals run that acted outside the plan (plan #1184), a stage of
 * the overnight tick, which pg_cron calls every four minutes. A run is read
 * within a few minutes of finishing, and a run the quiet sweep has just
 * closed as failed is read on the same tick, since it may have closed steps
 * before it stopped. Every account's runs, as the quiet sweep reads them;
 * each account's own consent to Jev decides whether its runs are read.
 */
export async function runGoalsActedCheck(deps?: {
  client?: GoalsSupabaseClient;
  now?: number;
}): Promise<ActedRunsResult> {
  const client = deps?.client ?? createGoalsServiceSupabase();
  return flagActedRuns({ client, now: deps?.now });
}
