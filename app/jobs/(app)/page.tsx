import { redirect } from 'next/navigation';
import { createClient, requireUser } from '@/lib/jobs/auth/server';
import { createCoreClient } from '@/lib/core/auth/server';
import { loadPipeline } from '@/lib/jobs/applications/load';
import { loadFunnel } from '@/lib/jobs/home/funnel-load';
import { ACTIVITY_HREF } from '@/lib/jobs/home/now-tabs';
import { loadSinceView } from '@/lib/jobs/home/since-load';
import { loadToday } from '@/lib/jobs/today/load';
import { NowDashToday } from '@/components/shell/dash-today-fold';
import { TodayPage } from './_home/today-page';

export const metadata = { title: 'Now' };

/**
 * Now, and where `/jobs` lands (plan #1150, #1591, #1937.9, #1496.7.2).
 *
 * Reads the rows and hands them to TodayPage, which draws them. The pipeline
 * is read once for the funnel (lib/jobs/home/funnel-load.ts), and the board for This week's interviews
 * and for the mail waiting on you, which is left out of "Since you last
 * looked"; the mail itself is listed in the Jobs Inbox.
 *
 * /jobs/today, the page Home replaced, redirects here. Activity is its own
 * tab again (note eb898bfd), and `?tab=activity` sends you there.
 */
export default async function JobsToday({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string | string[] }>;
}) {
  const user = await requireUser();
  const supabase = await createClient();
  // Activity was a tab of Now until it got its own back (note eb898bfd).
  const tab = (await searchParams).tab;
  if (tab === 'activity' || (Array.isArray(tab) && tab.includes('activity'))) redirect(ACTIVITY_HREF);

  const { data: profile } = await supabase
    .from('profiles')
    .select('timezone')
    .eq('id', user.id)
    .maybeSingle();

  const timezone = (profile?.timezone as string) ?? 'UTC';

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
