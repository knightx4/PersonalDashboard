import { createClient, requireUser } from '@/lib/jobs/auth/server';
import { createCoreClient } from '@/lib/core/auth/server';
import { loadActivity } from '@/lib/jobs/activity/load';
import { loadPipeline } from '@/lib/jobs/applications/load';
import { loadFunnel } from '@/lib/jobs/home/funnel-load';
import { NOW_TAB_ADDRESS, NOW_TABS } from '@/lib/jobs/home/now-tabs';
import { loadSinceView } from '@/lib/jobs/home/since-load';
import { loadToday } from '@/lib/jobs/today/load';
import { tabFrom } from '@/lib/tabs';
import { NowDashToday } from '@/components/shell/dash-today-fold';
import { TodayPage } from './_home/today-page';

export const metadata = { title: 'Now' };

/**
 * Now, and where `/jobs` lands (plan #1150, #1591, #1937.9, #1496.7.2).
 *
 * Reads the open tab's rows and hands them to TodayPage, which draws them.
 * On Overview the pipeline is read once for the funnel
 * (lib/jobs/home/funnel-load.ts), and the board for This week's interviews
 * and for the mail waiting on you, which is left out of "Since you last
 * looked"; the mail itself is listed in the Jobs Inbox. On Activity it reads
 * the feed and the inboxes the Check now button scans.
 *
 * /jobs/today, the page Home replaced, and /jobs/activity redirect here.
 */
export default async function JobsToday({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string | string[] }>;
}) {
  const user = await requireUser();
  const supabase = await createClient();
  const tab = tabFrom((await searchParams).tab, NOW_TABS, NOW_TAB_ADDRESS);

  const { data: profile } = await supabase
    .from('profiles')
    .select('timezone')
    .eq('id', user.id)
    .maybeSingle();

  const timezone = (profile?.timezone as string) ?? 'UTC';

  if (tab === 'activity') {
    const core = await createCoreClient();
    const [{ data: accounts }, activity] = await Promise.all([
      core
        .from('email_accounts')
        .select('id, email_address, status, last_synced_at, backfill_completed_at')
        .eq('user_id', user.id)
        .order('created_at'),
      loadActivity(supabase, core, user.id),
    ]);
    return (
      <TodayPage
        tab="activity"
        timezone={timezone}
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

  const [core, pipeline] = await Promise.all([createCoreClient(), loadPipeline(supabase, user.id)]);

  const now = new Date();
  const [board, funnel] = await Promise.all([
    loadToday(supabase, user.id, { now }),
    loadFunnel(supabase, user.id, pipeline, now),
  ]);
  const since = await loadSinceView(supabase, core, {
    userId: user.id,
    timezone,
    waitingEventIds: board.waiting.map((item) => item.eventId),
  });

  return (
    <TodayPage
      board={board}
      funnel={funnel}
      since={since}
      timezone={timezone}
      dashToday={<NowDashToday workspace="jobs" className="" />}
    />
  );
}
