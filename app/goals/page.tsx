import { PageHeader } from '@/components/shell/page-header';
import { createGoalsClient } from '@/lib/goals/auth/server';
import { loadDailyView } from '@/lib/goals/steps-store';
import { DailyView } from './daily-view';

export const metadata = { title: 'Goals' };
export const dynamic = 'force-dynamic';

/**
 * The Goals home, for a once-a-day visit (docs/GOALS-SPEC.md, "The daily
 * view"; plan #926): what is waiting on you, then the next few things for
 * each active goal. Adding and arranging goals is on the All goals tab, and
 * each goal's full tree is one tap from here.
 *
 * The loader checks that the schema is exposed, so a deployment where `goals`
 * is not exposed to PostgREST says so here instead of showing an empty page
 * that looks right.
 */
export default async function GoalsPage() {
  const view = await loadDailyView(await createGoalsClient());

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        title="Goals"
        description="The next few things for each goal you are working on."
      />
      <DailyView view={view} />
    </div>
  );
}
