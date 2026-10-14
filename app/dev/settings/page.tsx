import { createClient, requireUser } from '@/lib/auth/server';
import { loadPlanForRequest } from '@/lib/plan/request-plan';
import { buildPlanTree } from '@/lib/plan/tree';
import { loadFeatureFires, loadLastRuns, loadStartedRuns } from '@/lib/plan/runs';
import { loadOvernightRun } from '@/lib/plan/overnight';
import { runnerCard } from '@/lib/plan/runner-card';
import { loadAutoApprove } from '@/lib/plan/auto-approve';
import { planRoutine } from '@/lib/feedback/routine';
import { loadNotesLastRun } from '@/lib/feedback/last-worked';
import { NOTES_WORK_KINDS } from '@/lib/feedback/load';
import { loadVisionReviewStatus } from '@/lib/specs/vision-review-run';
import { createGoalsClient } from '@/lib/goals/auth/server';
import { loadStartedGoalRuns } from '@/lib/goals/runs-store';
import { goalsStatus } from '@/lib/goals/runner-status';
import { loadGoalsNight } from '@/inngest/goals/overnight';
import { DevSettingsView } from './settings-view';

export const metadata = { title: 'Dev settings' };
export const dynamic = 'force-dynamic';

/** The time the rows are measured against. Outside the component because it reads the clock. */
function readClock(): number {
  return Date.now();
}

/** The goal runs going and the goals night's rows, or null when they could not be read. */
async function readGoals(userId: string) {
  try {
    const client = await createGoalsClient();
    const [started, night] = await Promise.all([
      loadStartedGoalRuns(client),
      loadGoalsNight(client, userId, readClock()),
    ]);
    return { started, night };
  } catch (error) {
    console.error(`Dash could not read the goal runs: ${(error as Error).message}`);
    return null;
  }
}

/**
 * Dev settings, at the foot of the Dev column (plan #1937.10). The routines'
 * presses moved here from Home, read with the same loaders Home and /dev/plan
 * use, so the three pages cannot come to different answers about what is
 * running. The layout has already refused anyone but the owner.
 */
export default async function DevSettingsPage() {
  const user = await requireUser();
  const supabase = await createClient();
  // A goals read that fails leaves the Plan row as it was rather than taking
  // the page down.
  const goalsRead = readGoals(user.id);
  const now = readClock();
  const [plan, overnight, fires, lastRuns, started, openNotes, notesLastRun, vision, autoApprove] =
    await Promise.all([
      loadPlanForRequest(user.id),
      loadOvernightRun(supabase, user.id),
      loadFeatureFires(supabase, user.id),
      loadLastRuns(supabase, user.id),
      loadStartedRuns(supabase, user.id),
      // A count, not the rows: what makes "run it" answerable is how many are
      // waiting, and only what a notes run would work.
      supabase
        .from('feedback_items')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', user.id)
        .in('status', ['open', 'in_progress', 'blocked', 'planned'])
        .in('kind', [...NOTES_WORK_KINDS]),
      loadNotesLastRun(supabase, user.id),
      loadVisionReviewStatus(supabase, user.id),
      loadAutoApprove(supabase, user.id),
    ]);

  const card = runnerCard({
    run: overnight,
    fires,
    items: plan.items,
    sections: buildPlanTree(plan),
    started,
    lastRuns: Object.values(lastRuns),
  });

  const goalsRows = await goalsRead;
  const goals = goalsRows
    ? goalsStatus({
        ...goalsRows,
        nightStartedAt: overnight?.running ? overnight.startedAt : null,
        now,
      })
    : null;

  return (
    <DevSettingsView
      run={overnight}
      canSend={Boolean(planRoutine().token)}
      card={card}
      goals={goals}
      openNotes={openNotes.count ?? 0}
      notesLastRun={notesLastRun}
      vision={vision}
      autoApprove={autoApprove}
      now={now}
    />
  );
}
