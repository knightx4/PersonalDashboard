import { createClient, requireUser } from '@/lib/jobs/auth/server';
import { createCoreClient } from '@/lib/core/auth/server';
import { PageHeader } from '@/components/jobs/shell/page-header';
import { ActivityFeed } from '@/components/jobs/activity/activity-feed';
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

  const [{ data: profile }, activity] = await Promise.all([
    supabase.from('profiles').select('timezone').eq('id', user.id).single(),
    loadActivity(supabase, core, user.id),
  ]);

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        title="Activity"
        description="What the syncs have actually changed. The inbox reads mail and opens or moves roles; the nightly sweep closes what has gone quiet and raises the nudges on This week."
      />
      <ActivityFeed activity={activity} timezone={profile?.timezone ?? 'UTC'} />
    </div>
  );
}
