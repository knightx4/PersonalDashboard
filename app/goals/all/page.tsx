import { PageHeader } from '@/components/shell/page-header';
import { createGoalsClient } from '@/lib/goals/auth/server';
import { loadAreas, loadGoals } from '@/lib/goals/store';
import { loadGoalProgress } from '@/lib/goals/steps-store';
import { groupGoals } from '@/lib/goals/tree';
import { GoalsView } from '../goals-view';

export const metadata = { title: 'All goals' };
export const dynamic = 'force-dynamic';

/**
 * Every area and the goals under it (plan #924), where they are added, named,
 * ordered and archived. Each goal links to its full tree of steps (#925). It
 * was the home until the daily view took that place (#926).
 *
 * The loaders check that the schema is exposed, so a deployment where `goals`
 * is not exposed to PostgREST says so here instead of showing an empty page
 * that looks right.
 */
export default async function AllGoalsPage() {
  const client = await createGoalsClient();
  const [areas, goals, progress] = await Promise.all([
    loadAreas(client),
    loadGoals(client),
    loadGoalProgress(client),
  ]);

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        title="All goals"
        description="What you are working towards, grouped by the areas of your life they belong to."
      />
      <GoalsView areas={groupGoals(areas, goals)} progress={progress} />
    </div>
  );
}
