import { createClient, requireUser } from '@/lib/auth/server';
import { PageHeader } from '@/components/shell/page-header';
import { loadPlan, planSections } from '@/lib/plan/load';
import { PlanView } from './plan-view';

export const metadata = { title: 'Plan' };

/**
 * What is built, what is being built, and what is still only written down.
 *
 * Third of the three lists in this workspace, and the one that spans the
 * longest. A bug is a thing that is wrong now; an idea is a thing nobody has
 * committed to; the plan is the middle — the steps that were decided on, in
 * the order they were decided, with the ones that are done marked off.
 *
 * It began as `docs/BUILD-ORDER.md` and is seeded from it once. After that the
 * markdown is background reading and this is the working copy: an app deployed
 * to a server cannot write to a file in its own repository, and the ✅
 * convention has two states where the useful question has four and no room at
 * all for a note saying what a step is waiting on.
 */
export default async function DevPlanPage() {
  const user = await requireUser();
  const supabase = await createClient();
  const items = await loadPlan(supabase, user.id);

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <PageHeader
        title="Plan"
        description="The build order for each module, as something you can work rather than read. Seeded from the docs once; edited here after."
      />
      <PlanView sections={planSections(items)} empty={items.length === 0} />
    </div>
  );
}
