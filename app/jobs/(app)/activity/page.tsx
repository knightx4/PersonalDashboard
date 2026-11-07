import { createClient, requireUser } from '@/lib/jobs/auth/server';
import { createCoreClient } from '@/lib/core/auth/server';
import { loadActivity } from '@/lib/jobs/activity/load';
import { ActivityPage } from '../_home/today-page';

export const metadata = { title: 'Activity' };

/**
 * Jobs' Activity tab (note eb898bfd): the feed of what the syncs changed and
 * the inboxes the Check now button scans. It was a tab of Now from plan
 * #1496.7.2, and `/jobs?tab=activity` from then redirects here.
 */
export default async function JobsActivity() {
  const user = await requireUser();
  const supabase = await createClient();
  const core = await createCoreClient();

  const [{ data: profile }, { data: accounts }, activity] = await Promise.all([
    supabase.from('profiles').select('timezone').eq('id', user.id).maybeSingle(),
    core
      .from('email_accounts')
      .select('id, email_address, status, last_synced_at, backfill_completed_at')
      .eq('user_id', user.id)
      .order('created_at'),
    loadActivity(supabase, core, user.id),
  ]);

  return (
    <ActivityPage
      timezone={(profile?.timezone as string) ?? 'UTC'}
      activity={activity}
      accounts={(accounts ?? []).map((account) => ({
        id: account.id as string,
        emailAddress: account.email_address as string,
        status: account.status as string,
        lastSyncedAt: (account.last_synced_at as string) ?? null,
        backfillCompletedAt: (account.backfill_completed_at as string) ?? null,
      }))}
    />
  );
}
