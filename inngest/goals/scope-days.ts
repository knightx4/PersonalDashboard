import 'server-only';

import type { CoreSupabaseClient } from '@/lib/core/db/schema-name';
import { createGoalsServiceSupabase } from '@/inngest/goals/supabase-admin';

/**
 * Save today's step counts for every open goal and feature (plan #1836), a
 * stage of the daily cron. The counting is core.refresh_scope_days in the
 * database, which writes one row per scope for the person's own today and
 * leaves earlier days as they were.
 */
export type ScopeDaysResult = { written: number };

export async function runScopeDays(deps?: { client?: CoreSupabaseClient }): Promise<ScopeDaysResult> {
  const client =
    deps?.client ?? (createGoalsServiceSupabase().schema('core') as unknown as CoreSupabaseClient);
  const { data, error } = await client.rpc('refresh_scope_days', { p_backfill: false });
  if (error) throw new Error(`Could not save the day's step counts: ${error.message}`);
  return { written: typeof data === 'number' ? data : 0 };
}
