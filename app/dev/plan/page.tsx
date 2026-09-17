import { createClient, requireUser } from '@/lib/auth/server';
import { PageHeader } from '@/components/shell/page-header';
import { loadPlan } from '@/lib/plan/load';
import { syncPlanFromSeed } from '@/lib/plan/sync';
import { endQuietRuns, loadLastRuns } from '@/lib/plan/runs';
import { loadCommitChecks, refreshCommitChecks } from '@/lib/plan/ci';
import { loadOvernightRun } from '@/lib/plan/overnight';
import { planRoutine } from '@/lib/feedback/routine';
import {
  applyView,
  buildPlanTree,
  flattenSections,
  handedToClaude,
  isPlanView,
  splitFinished,
  summarize,
  type PlanView,
} from '@/lib/plan/tree';
import { OvernightControl } from './overnight-control';
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
 * It began as `docs/BUILD-ORDER.md`, and the steps that came from it live in
 * `lib/plan/seed.ts`. The markdown is background reading and this is the
 * working copy: an app deployed to a server cannot write to a file in its own
 * repository, and the ✅ convention has two states where the useful question
 * has five and no room at all for a note saying what a step is waiting on.
 *
 * Opening the page brings in any seed step that has never been offered. That is
 * a write on a page load, which is normally the wrong thing -- but this one
 * cannot surprise anybody: it adds rows the repository already declares, never
 * touches a row that is there, and offers each step exactly once, so a step you
 * delete stays deleted. Without it a slice planned in the seed reached the page
 * only if somebody retyped it into a form, which is how a plan page falls
 * behind the plan and then stops being opened. Steps written straight into the
 * plan -- by hand here, or by a session through `scripts/plan.ts` -- never go
 * near this and are unaffected.
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

  // Before the load, so anything new appears on this render rather than the
  // next one. It carries its failure back instead of throwing: a plan that
  // could not be synced is still a plan worth reading, and the line below says
  // so rather than the page falling over.
  const sync = await syncPlanFromSeed(supabase, user.id);

  // Before the runs are read, so a run that ended hours ago is drawn as ended
  // on this render rather than still saying it is going. Nothing reports the
  // end of a run, so this is where it gets noticed.
  await endQuietRuns({ supabase, userId: user.id });

  // And what CI said about the commits the closed steps shipped in. Nothing is
  // asked of GitHub unless some commit has no answer yet, so this costs a
  // request only after something new has been closed.
  const checks = await refreshCommitChecks({ supabase, userId: user.id });

  const [data, lastRuns, commitChecks, overnight] = await Promise.all([
    loadPlan(supabase, user.id),
    loadLastRuns(supabase, user.id),
    loadCommitChecks(supabase, user.id),
    // The runner's standing intention, which is one row and is read here
    // rather than inside the tree: it is about the plan as a whole, and the
    // control that shows it sits above the whole page.
    loadOvernightRun(supabase, user.id),
  ]);
  const whole = buildPlanTree(data);
  const narrowed = applyView(whole, view);
  const summary = summarize(whole);

  // Only on Everything, which is the one view a finished feature reaches at
  // all: it goes into the fold at the foot of the page rather than sitting in
  // its module among the nine features that still have work in them.
  const { sections, finished } =
    view === 'all' ? splitFinished(narrowed) : { sections: narrowed, finished: [] };

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

  // Wider than the other dev pages, which are prose and lists at max-w-3xl.
  // This one is a table with six columns and a tree indenting the first of
  // them, and the Status column took the last of the room the titles had: at
  // 3xl a third-level step's title truncated after about two words. The page
  // earns the extra width by being the only one here that is a grid rather
  // than a column of text.
  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <PageHeader
        title="Plan"
        description="Features, the steps that get you there, and the steps beneath those. Seeded from the docs once; edited here after, and read from here by whoever builds next."
      />
      {sync.added > 0 && (
        <p className="text-small text-ink-muted">
          Brought in {sync.added} new {sync.added === 1 ? 'step' : 'steps'} from the build order.
        </p>
      )}
      {sync.error && (
        <p className="text-small text-caution">Could not check for new steps: {sync.error}</p>
      )}
      {/* A sentence now rather than a status code, so it is printed as one and
        in the same tone as the sync failure above it -- a setting nobody can
        act on until they are told which one is not a quieter problem than a
        step that did not arrive. */}
      {checks.error && (
        <p className="text-small text-caution">Could not read CI. {checks.error}</p>
      )}
      <OvernightControl run={overnight} canSend={Boolean(planRoutine().token)} />
      <PlanViewComponent
        sections={sections}
        finished={finished}
        summary={summary}
        view={view}
        catalog={catalog}
        lastRuns={lastRuns}
        commitChecks={commitChecks}
        empty={data.items.length === 0}
        canSend={Boolean(planRoutine().token)}
        queued={handedToClaude(whole).length}
      />
    </div>
  );
}
