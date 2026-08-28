import { createServiceSupabase } from '@/inngest/jobs/supabase-admin';
import { pumpInboxSync, startIncrementalSync } from '@/inngest/jobs/inbox-sync';
import { runIncrementalSync, type IncrementalSyncSummary } from '@/inngest/cron/incremental';

/**
 * Incremental sync for every job search inbox that finished its backfill.
 *
 * There are none yet -- the job workspace has no Gmail grant of its own, so
 * this returns an empty summary. It is wired up regardless so that connecting
 * an inbox is the only step needed, rather than connecting one and then
 * discovering nothing is scheduled.
 */
export async function runJobIncrementalSync(origin: string): Promise<IncrementalSyncSummary> {
  const supabase = createServiceSupabase();
  return runIncrementalSync({
    origin,
    listAccounts: async () => {
      const { data, error } = await supabase
        .from('email_accounts')
        .select('id, user_id')
        .eq('status', 'active')
        .not('backfill_completed_at', 'is', null);
      if (error) throw new Error(error.message);
      return (data ?? []) as { id: string; user_id: string }[];
    },
    start: startIncrementalSync,
    pump: pumpInboxSync,
  });
}
