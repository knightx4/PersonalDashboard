import { createClient, requireUser } from '@/lib/jobs/auth/server';
import { createCoreClient } from '@/lib/core/auth/server';
import { PageHeader } from '@/components/shell/page-header';
import { ActivityFeed } from '@/components/jobs/activity/activity-feed';
import { CheckInboxNow } from '@/components/jobs/activity/check-inbox-now';
import { loadActivity } from '@/lib/jobs/activity/load';

export const metadata = { title: 'Activity' };

/**
 * What the syncs have changed, as its own tab.
 *
 * It used to be a section in Settings — a page you open to change something,
 * not to find out what happened — so the answer to "what is new" was three
 * screens down under the inbox forms.
 */
export default async function ActivityPage() {
  const user = await requireUser();
  const supabase = await createClient();
  const core = await createCoreClient();

  const [{ data: profile }, { data: accounts }, activity] = await Promise.all([
    supabase.from('profiles').select('timezone').eq('id', user.id).single(),
    core
      .from('email_accounts')
      .select('id, email_address, status, last_synced_at, backfill_completed_at')
      .eq('user_id', user.id)
      .order('created_at'),
    loadActivity(supabase, core, user.id),
  ]);

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        title="Activity"
        description="What the syncs have actually changed. The inbox reads mail and opens or moves roles; the nightly sweep closes what has gone quiet and raises the nudges on This week."
      />
      <CheckInboxNow
        accounts={(accounts ?? []).map((account) => ({
          id: account.id as string,
          emailAddress: account.email_address as string,
          status: account.status as string,
          lastSyncedAt: (account.last_synced_at as string) ?? null,
          backfillCompletedAt: (account.backfill_completed_at as string) ?? null,
        }))}
      />
      <ActivityFeed activity={activity} timezone={profile?.timezone ?? 'UTC'} />
    </div>
  );
}
