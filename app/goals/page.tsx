import { PageHeader } from '@/components/shell/page-header';
import { createGoalsClient } from '@/lib/goals/auth/server';
import { loadAreas, loadGoals } from '@/lib/goals/store';
import { loadStepCounts } from '@/lib/goals/steps-store';
import { groupGoals } from '@/lib/goals/tree';
import { GoalsView } from './goals-view';

export const metadata = { title: 'Goals' };
export const dynamic = 'force-dynamic';

/**
 * The Goals home: your areas and the goals under each (plan #924), each goal
 * linking to its full tree of steps (#925). The next few things per goal
 * arrive with the daily view (#926).
 *
 * The loaders check that the schema is exposed, so a deployment where `goals`
 * is not exposed to PostgREST says so here instead of showing an empty page
 * that looks right.
 */
export default async function GoalsPage() {
  const client = await createGoalsClient();
  const [areas, goals, stepCounts] = await Promise.all([
    loadAreas(client),
    loadGoals(client),
    loadStepCounts(client),
  ]);

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        title="Goals"
        description="What you are working towards, grouped by the areas of your life they belong to."
      />
      <GoalsView areas={groupGoals(areas, goals)} stepCounts={stepCounts} />
    </div>
  );
}
