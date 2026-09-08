import { createClient, requireUser } from '@/lib/auth/server';
import { PageHeader } from '@/components/shell/page-header';
import { loadPlan, planSections } from '@/lib/plan/load';
import { syncPlanFromSeed } from '@/lib/plan/sync';
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
 * It began as `docs/BUILD-ORDER.md` and the steps live in `lib/plan/seed.ts`.
 * After that the markdown is background reading and this is the working copy:
 * an app deployed to a server cannot write to a file in its own repository, and
 * the ✅ convention has two states where the useful question has four and no
 * room at all for a note saying what a step is waiting on.
 *
 * Opening the page brings in any seed step that has never been offered. That is
 * a write on a page load, which is normally the wrong thing -- but this one
 * cannot surprise anybody: it adds rows the repository already declares, never
 * touches a row that is there, and offers each step exactly once, so a step you
 * delete stays deleted. The alternative, a button, meant retyping every step
 * planned after the first import, which is how a plan page falls behind the
 * plan and stops being opened.
 */
export default async function DevPlanPage() {
  const user = await requireUser();
  const supabase = await createClient();

  // Before the load, so anything new appears on this render rather than the
  // next one. It carries its failure back instead of throwing: a plan that
  // could not be synced is still a plan worth reading, and the line below says
  // what happened rather than the page falling over.
  const sync = await syncPlanFromSeed(supabase, user.id);
  const items = await loadPlan(supabase, user.id);

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <PageHeader
        title="Plan"
        description="The build order for each module, as something you can work rather than read. New steps arrive from the repository; everything else is edited here."
      />
      {sync.added > 0 && (
        <p className="text-small text-ink-muted">
          Brought in {sync.added} new {sync.added === 1 ? 'step' : 'steps'} from the build order.
        </p>
      )}
      {sync.error && (
        <p className="text-small text-caution">
          Could not check for new steps: {sync.error}
        </p>
      )}
      <PlanView sections={planSections(items)} empty={items.length === 0} />
    </div>
  );
}
