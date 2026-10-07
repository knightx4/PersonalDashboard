import { createClient, requireUser } from '@/lib/jobs/auth/server';
import { createCoreClient } from '@/lib/core/auth/server';
import { loadPipeline } from '@/lib/jobs/applications/load';
import { summariseSearch, type SummaryInterview } from '@/lib/jobs/home/summary';
import { loadSinceView } from '@/lib/jobs/home/since-load';
import { loadReviewQueue } from '@/lib/jobs/review/load';
import { liveByMove } from '@/lib/jobs/today/live';
import { loadToday } from '@/lib/jobs/today/load';
import { reviewPeek } from '@/lib/jobs/today/review-peek';
import { TodayPage } from './_home/today-page';

export const metadata = { title: 'Today' };

/**
 * Today, and where `/jobs` lands (plan #1150, #1591).
 *
 * Reads everything once and hands it to TodayPage, which draws it. The
 * pipeline is read once for the live list, the numbers and This week's
 * follow-up drafts. This week's board is read before "Since you last looked",
 * which leaves out the mail This week lists as waiting on you; the same mail
 * puts the live list's move on you.
 *
 * /jobs/today, the page Home replaced, redirects here.
 */
export default async function JobsToday() {
  const user = await requireUser();
  const supabase = await createClient();

  const { data: profile } = await supabase
    .from('profiles')
    .select('display_name, timezone')
    .eq('id', user.id)
    .maybeSingle();

  const timezone = (profile?.timezone as string) ?? 'UTC';
  const senderName = (profile?.display_name as string) ?? null;

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

  const [board, queue] = await Promise.all([
    loadToday(supabase, user.id, { senderName, pipeline }),
    loadReviewQueue(supabase, core, user.id),
  ]);
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
      review={reviewPeek(queue.rows)}
      board={board}
      summary={summariseSearch(pipeline, interviews, new Date())}
      live={liveByMove(pipeline, new Set(board.waiting.map((item) => item.applicationId)))}
      since={since}
      timezone={timezone}
    />
  );
}
