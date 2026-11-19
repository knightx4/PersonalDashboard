import { createClient, requireUser } from '@/lib/jobs/auth/server';
import { createCoreClient } from '@/lib/core/auth/server';
import { loadActivity } from '@/lib/jobs/activity/load';
import { ActivityPage } from '../_home/today-page';

export const metadata = { title: 'Activity' };

/**
 * Jobs' Activity tab (note eb898bfd): the feed of what the syncs changed. It
 * was a tab of Now from plan #1496.7.2, and `/jobs?tab=activity` from then
 * redirects here. Checking the inbox now is in Settings (note d6454af0).
 */
export default async function JobsActivity() {
  const user = await requireUser();
  const supabase = await createClient();
  const core = await createCoreClient();

  const [{ data: profile }, activity] = await Promise.all([
    supabase.from('profiles').select('timezone').eq('id', user.id).maybeSingle(),
    loadActivity(supabase, core, user.id),
  ]);

  return <ActivityPage timezone={(profile?.timezone as string) ?? 'UTC'} activity={activity} />;
}
