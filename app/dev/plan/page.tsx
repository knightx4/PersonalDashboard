import { createClient, requireUser } from '@/lib/auth/server';
import { PageHeader } from '@/components/shell/page-header';
import { loadPlan } from '@/lib/plan/load';
import { planRoutine } from '@/lib/feedback/routine';
import {
  applyView,
  buildPlanTree,
  flattenSections,
  isPlanView,
  summarize,
  type PlanView,
} from '@/lib/plan/tree';
import { PlanView as PlanViewComponent, type PlanCatalogEntry } from './plan-view';

export const metadata = { title: 'Plan' };

/**
 * What is built, what is being built, and what is still only written down.
 *
 * Third of the three lists in this workspace, and the one that spans the
 * longest. A bug is a thing that is wrong now; an idea is a thing nobody has
 * committed to; the plan is the middle -- the features that were decided on,
 * the steps that get you to each, and the steps beneath those, with the ones
 * that are done marked off and the ones that could be picked up next known.
 *
 * It began as `docs/BUILD-ORDER.md` and is seeded from it once. After that the
 * markdown is background reading and this is the working copy: an app deployed
 * to a server cannot write to a file in its own repository, and the ✅
 * convention has two states where the useful question has five and no room at
 * all for a note saying what a step is waiting on.
 *
 * It is also the source of truth for what gets built next by anybody, Claude
 * included: `scripts/plan.ts` reads the same rows, and a step handed to Claude
 * from here is the one the routine picks up. See docs/PLAN-SPEC.md.
 *
 * The view is a search parameter rather than state, so "the ready steps" is a
 * link somebody can keep. It opens on the open steps: a plan is consulted for
 * what is left far more often than for what is done, and the finished ones
 * are one click away.
 */
export default async function DevPlanPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string | string[] }>;
}) {
  const user = await requireUser();
  const supabase = await createClient();
  const params = await searchParams;

  const requested = Array.isArray(params.view) ? params.view[0] : params.view;
  const view: PlanView = requested && isPlanView(requested) ? requested : 'open';

  const data = await loadPlan(supabase, user.id);
  const whole = buildPlanTree(data);
  const sections = applyView(whole, view);
  const summary = summarize(whole);

  // Every step, for the pickers: a parent to move under, a step to wait on.
  // Light on purpose -- the tree is already on the page once.
  const catalog: PlanCatalogEntry[] = flattenSections(whole).map((node) => ({
    id: node.id,
    number: node.number,
    title: node.title,
    module: node.module,
    parentId: node.parentId,
    depth: node.depth,
    closed: node.status === 'done' || node.status === 'dropped',
  }));

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <PageHeader
        title="Plan"
        description="Features, the steps that get you there, and the steps beneath those. Seeded from the docs once; edited here after, and read from here by whoever builds next."
      />
      <PlanViewComponent
        sections={sections}
        summary={summary}
        view={view}
        catalog={catalog}
        empty={data.items.length === 0}
        canSend={Boolean(planRoutine().token)}
      />
    </div>
  );
}
