import { requireUser } from '@/lib/auth/server';
import { loadAccountSettings } from '@/lib/core/account/settings';
import { goalsRoutine } from '@/lib/feedback/routine';
import { formatDateTime } from '@/lib/jobs/applications/load';
import { createYouClient } from '@/lib/you/auth/server';
import { latestInsightRun, listInsights } from '@/lib/you/insights';
import { insightRunState } from '@/lib/you/insights-run';
import { InsightsView } from './insights-view';

export const metadata = { title: 'Insights' };
export const dynamic = 'force-dynamic';

/**
 * You's Insights tab (plan #2413.5): Dash's insights one at a time, with
 * right, not quite and wrong, the ones marked under Earlier, and Look again.
 * Every status is read, so a card marked and then retired or superseded by a
 * run still shows under Earlier with the mark; only shown ones are dealt.
 */
export default async function Page() {
  const user = await requireUser();
  const you = await createYouClient();
  const [all, run, settings] = await Promise.all([
    listInsights(you, user.id, { statuses: ['shown', 'retired', 'superseded'] }),
    latestInsightRun(you, user.id),
    loadAccountSettings(user.id),
  ]);
  const insights = all.filter((insight) => insight.status === 'shown' || insight.verdict);
  const routine = goalsRoutine();
  return (
    <InsightsView
      insights={insights}
      run={insightRunState(run)}
      runWhen={run ? formatDateTime(run.requestedAt, settings.timezone) : null}
      available={Boolean(process.env.ANTHROPIC_API_KEY?.trim())}
      rereadAvailable={Boolean(routine.id && routine.token)}
      timezone={settings.timezone}
    />
  );
}
