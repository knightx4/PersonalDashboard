import { PageHeader } from '@/components/shell/page-header';
import { requireUser } from '@/lib/auth/server';
import { isOwner } from '@/lib/dev/owner';
import { createGoalsClient } from '@/lib/goals/auth/server';
import { areaRunView, type AreaRunView } from '@/lib/goals/shaping';
import { loadAreaRuns } from '@/lib/goals/shaping-store';
import { loadAreas, loadGoals } from '@/lib/goals/store';
import { loadGoalProgress } from '@/lib/goals/steps-store';
import { groupGoals } from '@/lib/goals/tree';
import { GoalsView } from '../goals-view';

export const metadata = { title: 'All goals' };
export const dynamic = 'force-dynamic';

/**
 * Every area and the goals under it (plan #924), where they are added, named,
 * ordered and archived. Each goal links to its full tree of steps (#925). It
 * was the home until the daily view took that place (#926). Each area can
 * ask Claude to propose its goals (Plan this area).
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

export default async function AllGoalsPage() {
  const user = await requireUser();
  const client = await createGoalsClient();
  const [areas, goals, progress, runs, canRun] = await Promise.all([
    loadAreas(client),
    loadGoals(client),
    loadGoalProgress(client),
    loadAreaRuns(client),
    isOwner({ user }),
  ]);

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader title="All goals" />
      <GoalsView
        areas={groupGoals(areas, goals)}
        progress={progress}
        areaRuns={areaRunViews(runs)}
        canRun={canRun}
      />
    </div>
  );
}
