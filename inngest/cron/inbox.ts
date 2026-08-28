import { createCoreServiceSupabase } from '@/inngest/core/supabase-admin';
import { pumpInboxSync, startIncrementalSync } from '@/inngest/core/inbox-sync';
import { runIncrementalSync, type IncrementalSyncSummary } from '@/inngest/cron/incremental';

/**
 * Incremental sync for every connected inbox that finished its backfill.
 *
 * One pass over the mailbox now serves both workspaces: the accounts live in
 * core, and each message is offered to every linker. There used to be two of
 * these, one per workspace, fetching the same messages.
 */
export async function runInboxIncrementalSync(origin: string): Promise<IncrementalSyncSummary> {
  const supabase = createCoreServiceSupabase();
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
