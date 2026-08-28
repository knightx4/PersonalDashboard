import { createServiceSupabase } from '@/inngest/supabase-admin';
import { pumpInboxSync, startIncrementalSync } from '@/inngest/inbox-backfill';
import { runIncrementalSync, type IncrementalSyncSummary } from '@/inngest/cron/incremental';

/** Incremental sync for every commerce inbox that finished its backfill. */
export async function runShoppingIncrementalSync(origin: string): Promise<IncrementalSyncSummary> {
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
