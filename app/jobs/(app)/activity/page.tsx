import { createClient, requireUser } from '@/lib/jobs/auth/server';
import { createCoreClient } from '@/lib/core/auth/server';
import { loadActivity } from '@/lib/jobs/activity/load';
import { ActivityView } from './activity-view';

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
    <ActivityView
      accounts={(accounts ?? []).map((account) => ({
        id: account.id as string,
        emailAddress: account.email_address as string,
        status: account.status as string,
        lastSyncedAt: (account.last_synced_at as string) ?? null,
        backfillCompletedAt: (account.backfill_completed_at as string) ?? null,
      }))}
      activity={activity}
      timezone={profile?.timezone ?? 'UTC'}
    />
  );
}
