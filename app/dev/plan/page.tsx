import { createClient, requireUser } from '@/lib/auth/server';
import { PageHeader } from '@/components/shell/page-header';
import { loadPlan } from '@/lib/plan/load';
import { syncPlanFromSeed } from '@/lib/plan/sync';
import {
  endQuietRuns,
  loadFeatureFires,
  loadLastRuns,
  loadRunRaises,
  loadStartedRuns,
} from '@/lib/plan/runs';
import { loadCommitChecks } from '@/lib/plan/ci';
import { loadOvernightRun } from '@/lib/plan/overnight';
import { runnerCard } from '@/lib/plan/runner-card';
import { keyRefusal } from '@/lib/plan/work';
import type { LastRun } from '@/lib/plan/run-end';
import { planRoutine } from '@/lib/feedback/routine';
import {
  applyView,
  buildPlanTree,
  flattenSections,
  isPlanView,
  planLiveness,
  splitFinished,
  summarize,
  type PlanView,
} from '@/lib/plan/tree';
import { OvernightControl } from './overnight-control';
import { PlanView as PlanViewComponent, type PlanCatalogEntry } from './plan-view';

export const metadata = { title: 'Plan' };

/**
 * The claims on these steps, read against the last run on each.
 *
 * Out here rather than in the page because it reads the clock, and reading the
 * clock during a render is unstable. The answer is a snapshot either way: the
 * browser recomputes each row as its own clock ticks.
 */
function claimsAsOfNow(
  items: Parameters<typeof planLiveness>[0],
  runs: Parameters<typeof planLiveness>[1],
) {
  return planLiveness(items, runs, Date.now());
}

/**
 * Why GitHub is refusing the key, from the last run on each step.
 *
 * Out here beside `claimsAsOfNow` and for the same reason: it reads the clock,
 * and how old a refusal is decides whether it is still the state of the key.
 * The browser asks the route again once the page is up and prefers that
 * answer, so this is only what the first paint is drawn with.
 */
function refusedKeyAsOfNow(runs: Record<string, LastRun>): string | null {
  return keyRefusal(Object.values(runs), Date.now());
}

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
  searchParams: Promise<{ view?: string | string[]; q?: string | string[] }>;
}) {
  const user = await requireUser();
  const supabase = await createClient();
  const params = await searchParams;

  const requested = Array.isArray(params.view) ? params.view[0] : params.view;
  const view: PlanView = requested && isPlanView(requested) ? requested : 'open';
  // What to put in the plan's own search box on arrival. The app-wide search
  // sends a step here as `q=#612`, which unfolds the feature it sits under.
  const query = (Array.isArray(params.q) ? params.q[0] : params.q) ?? '';

  // Before the load, so anything new appears on this render rather than the
  // next one. It carries its failure back instead of throwing: a plan that
  // could not be synced is still a plan worth reading, and the line below says
  // so rather than the page falling over.
  const sync = await syncPlanFromSeed(supabase, user.id);

  // Before the runs are read, so a run that ended hours ago is drawn as ended
  // on this render rather than still saying it is going. Nothing reports the
  // end of a run, so this is where it gets noticed.
  await endQuietRuns({ supabase, userId: user.id });

  const [data, lastRuns, runRaises, commitChecks, overnight, fires, started] = await Promise.all([
    loadPlan(supabase, user.id),
    loadLastRuns(supabase, user.id),
    // What sessions have raised against a step, so an opened step can say what
    // its run asked for as well as what it pushed and closed.
    loadRunRaises(supabase, user.id),
    // What CI said about the commits the closed steps shipped in, as last
    // stored. The page asks GitHub for anything newer once it has drawn,
    // through `app/api/plan/checks`: asked here, it held every open of the page
    // on a walk of main's history.
    loadCommitChecks(supabase, user.id),
    // The runner's standing intention, one row, which is about the plan as a
    // whole rather than about any part of the tree.
    loadOvernightRun(supabase, user.id),
    // The presses the night made, for the control's totals. The same rows the
    // morning digest reads, through the same loader, so the two cannot come to
    // different answers about how many features a night got through. #633.
    // Alongside the rest rather than behind a look at the runner's row: it is
    // one indexed read of a table this page is already reading, and holding it
    // back would cost every load a round trip to save this one.
    loadFeatureFires(supabase, user.id),
    // Every run still going, after the sweep above, so the card can name each
    // session running in parallel rather than only the last fire (note 39576272).
    loadStartedRuns(supabase, user.id),
  ]);

  // What the runs say about the steps that are claimed, so the counts beside a
  // module heading and the bands in its bar read the claims the same way the
  // health column under them does. The rows are classified again in the browser
  // as the clock ticks; both go through `healthOf`, so the two cannot disagree
  // about a claim, only about how many minutes ago it was.
  const liveness = claimsAsOfNow(data.items, lastRuns);
  // And whether the reason those claims are being read off the clock is that
  // GitHub is refusing the key. Off the run rows, so it is on screen in the
  // first paint; the page asks the route again once it is up and takes that
  // answer instead.
  const refusedKey = refusedKeyAsOfNow(lastRuns);
  const whole = buildPlanTree(data, liveness);
  const narrowed = applyView(whole, view);
  const summary = summarize(whole);

  // The runner's card, read by the same function Dash reads it with, so the
  // two pages say the same thing about what is running. Off the whole tree
  // rather than the view: what is ready does not change with the filter.
  const card = runnerCard({
    run: overnight,
    fires,
    items: data.items,
    sections: whole,
    started,
    lastRuns: Object.values(lastRuns),
  });

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
    outline: node.outline,
    title: node.title,
    module: node.module,
    parentId: node.parentId,
    depth: node.depth,
    status: node.status,
    completedAt: node.completedAt,
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
      <OvernightControl
        run={overnight}
        canSend={Boolean(planRoutine().token)}
        night={card.night}
        on={card.on}
        progress={card.progress}
        push={card.push}
        ready={card.ready}
        next={card.next}
      />
      <PlanViewComponent
        sections={sections}
        finished={finished}
        summary={summary}
        view={view}
        initialQuery={query}
        // A second search hit while already here changes only `q`, and the box
        // holds its own state, so it is started again rather than kept.
        key={query}
        catalog={catalog}
        lastRuns={lastRuns}
        runRaises={runRaises}
        keyRefusal={refusedKey}
        liveness={liveness}
        commitChecks={commitChecks}
        empty={data.items.length === 0}
        canSend={Boolean(planRoutine().token)}
      />
    </div>
  );
}
