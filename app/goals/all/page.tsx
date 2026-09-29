import { PageHeader } from '@/components/shell/page-header';
import { createClient, requireUser } from '@/lib/auth/server';
import { loadAccountSettings } from '@/lib/core/account/settings';
import { isOwner } from '@/lib/dev/owner';
import { allGoalsViewOf, onYouByGoal } from '@/lib/goals/all-goals';
import { createGoalsClient } from '@/lib/goals/auth/server';
import { areaRunView, type AreaRunView } from '@/lib/goals/shaping';
import { loadAreaRuns } from '@/lib/goals/shaping-store';
import { loadAreas, loadGoals } from '@/lib/goals/store';
import { goalProgress, type GoalProgress } from '@/lib/goals/status';
import { loadLiveTree } from '@/lib/goals/steps-store';
import { todayRanked } from '@/lib/goals/today';
import { loadTodayInput } from '@/lib/goals/today-store';
import { groupGoals } from '@/lib/goals/tree';
import { todayIn } from '@/lib/todo/tasks/model';
import { GoalsView } from '../goals-view';

export const metadata = { title: 'All goals' };
export const dynamic = 'force-dynamic';

/**
 * Every area and the goals under it (plan #924), where they are added, named,
 * ordered and archived. Each goal links to its full tree of steps (#925). It
 * was the home until the daily view took that place (#926). Each area can
 * ask Claude to propose its goals (Plan this area).
 *
 * Open, On you and Everything narrow it (plan #1158), kept in `?view=` as a
 * goal page's step views are. On you is what the home's Today list gathers,
 * counted per goal, so the live tree is read once for that and for each
 * goal's bar.
 *
 * The loaders check that the schema is exposed, so a deployment where `goals`
 * is not exposed to PostgREST says so here instead of showing an empty page
 * that looks right.
 */
/** Each area's latest run as its line reads it. Outside the component because it reads the clock. */
function areaRunViews(runs: Awaited<ReturnType<typeof loadAreaRuns>>): Record<string, AreaRunView> {
  const now = Date.now();
  return Object.fromEntries(Object.entries(runs).map(([id, run]) => [id, areaRunView(run, now)]));
}

/** The clock, read outside the component because reading it during render is unstable. */
function now(): number {
  return Date.now();
}

export default async function AllGoalsPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string | string[] }>;
}) {
  const view = allGoalsViewOf((await searchParams).view);
  const user = await requireUser();
  const [client, supabase, account] = await Promise.all([
    createGoalsClient(),
    createClient(),
    loadAccountSettings(user.id),
  ]);
  const today = todayIn(account.timezone);
  const [areas, goals, tree, runs, canRun] = await Promise.all([
    loadAreas(client),
    // Archived goals are read only for Everything, the one view that shows them.
    loadGoals(client, { archived: view === 'all' }),
    loadLiveTree(client, { today }),
    loadAreaRuns(client),
    isOwner({ user }),
  ]);
  const onYou = onYouByGoal(
    todayRanked(
      await loadTodayInput(client, supabase, { userId: user.id, today, tree, now: now() }),
    ),
  );
  const progress: Record<string, GoalProgress> = {};
  for (const [goalId, steps] of tree.byGoal) {
    if (steps.length > 0) progress[goalId] = goalProgress(steps);
  }

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader title="All goals" />
      <GoalsView
        areas={groupGoals(areas, goals)}
        view={view}
        onYou={Object.fromEntries(onYou)}
        progress={progress}
        areaRuns={areaRunViews(runs)}
        canRun={canRun}
      />
    </div>
  );
}
