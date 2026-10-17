import { createClient, requireUser } from '@/lib/jobs/auth/server';
import { createCoreClient } from '@/lib/core/auth/server';
import { loadPipeline } from '@/lib/jobs/applications/load';
import { summariseSearch, type SummaryInterview } from '@/lib/jobs/home/summary';
import { loadSinceView } from '@/lib/jobs/home/since-load';
import { loadToday } from '@/lib/jobs/today/load';
import { NowDashToday } from '@/components/shell/dash-today-fold';
import { TodayPage } from './_home/today-page';

export const metadata = { title: 'Now' };

/**
 * Now, and where `/jobs` lands (plan #1150, #1591, #1937.9).
 *
 * Reads everything once and hands it to TodayPage, which draws it. The
 * pipeline is read once for the numbers and This week's follow-up drafts.
 * The board is read for This week's interviews and for the mail waiting on
 * you, which is left out of "Since you last looked"; the mail itself is
 * listed in the Jobs Inbox.
 *
 * /jobs/today, the page Home replaced, redirects here.
 */
export default async function JobsToday() {
  const user = await requireUser();
  const supabase = await createClient();

  const { data: profile } = await supabase
    .from('profiles')
    .select('timezone')
    .eq('id', user.id)
    .maybeSingle();

  const timezone = (profile?.timezone as string) ?? 'UTC';

  const [core, pipeline, interviewResult] = await Promise.all([
    createCoreClient(),
    loadPipeline(supabase, user.id),
    supabase
      .from('interviews')
      // applications!inner, as the Interviews page reads them, so a round
      // whose application is gone is not counted here and missing there.
      .select('id, scheduled_at, time_known, group_id, applications!inner ( id )')
      .eq('user_id', user.id)
      .not('scheduled_at', 'is', null),
  ]);

  const now = new Date();
  const board = await loadToday(supabase, user.id, { now });
  const since = await loadSinceView(supabase, core, {
    userId: user.id,
    timezone,
    waitingEventIds: board.waiting.map((item) => item.eventId),
  });

  const interviews: SummaryInterview[] | null = interviewResult.error
    ? null
    : (interviewResult.data ?? []).map((row) => ({
        id: row.id as string,
        scheduledAt: row.scheduled_at as string | null,
        timeKnown: row.time_known as boolean | null,
        groupId: row.group_id as string | null,
      }));

  return (
    <TodayPage
      board={board}
      summary={summariseSearch(pipeline, interviews, now)}
      since={since}
      timezone={timezone}
      dashToday={<NowDashToday workspace="jobs" className="" />}
    />
  );
}
