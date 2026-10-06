import Link from 'next/link';
import { FileText } from 'lucide-react';
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
import { liveRhythms, missedLine, practices, progressLine } from '@/lib/goals/rhythms';
import { syncRhythms } from '@/lib/goals/rhythms-store';
import { todayIn } from '@/lib/todo/tasks/model';
import { GoalsView, type AreaRhythm } from '../goals-view';

export const metadata = { title: 'All goals' };
export const dynamic = 'force-dynamic';

/**
 * Every area and the goals under it (plan #924), where they are added, named,
 * ordered and archived. Each goal links to its full tree of steps (#925). It
 * was the home until the daily view took that place (#926). Each area can
 * ask Dash to propose its goals (Plan this area), and lists its rhythms with
 * this period's progress. Each area is a section with an id, `#area-<id>`,
 * which is where a link to an area goes now that it has no page of its own.
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

/**
 * Each area's rhythms with this period's progress, keyed by area id: what
 * the area's own page listed as its practices before it was folded in here.
 * The periods are brought up to date as on the home (syncRhythms). A failed
 * read leaves the rhythms out rather than the page.
 */
async function areaRhythms(
  client: Awaited<ReturnType<typeof createGoalsClient>>,
  userId: string,
  tree: Awaited<ReturnType<typeof loadLiveTree>>,
  today: string,
): Promise<Record<string, AreaRhythm[]>> {
  try {
    const live = liveRhythms(
      tree.goals.map((g) => g.goal),
      tree.byGoal,
    );
    if (live.length === 0) return {};
    const records = await syncRhythms(client, userId, live, today);
    const areaOf = new Map(tree.goals.map((g) => [g.goal.id, g.goal.areaId]));
    const byArea: Record<string, AreaRhythm[]> = {};
    for (const rhythm of practices(live, records)) {
      const areaId = areaOf.get(rhythm.goalId);
      if (!areaId) continue;
      const line = [
        progressLine(rhythm.period, { count: rhythm.count, target: rhythm.target }),
        rhythm.missed > 0 ? missedLine(rhythm.period, rhythm.missed) : null,
        `For ${rhythm.goalTitle}`,
      ]
        .filter(Boolean)
        .join(' · ');
      (byArea[areaId] ??= []).push({
        id: rhythm.id,
        title: rhythm.title,
        goalId: rhythm.goalId,
        line,
      });
    }
    return byArea;
  } catch (error) {
    console.error('[all goals rhythms]', error instanceof Error ? error.message : error);
    return {};
  }
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
  const rhythms = await areaRhythms(client, user.id, tree, today);

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        title="All goals"
        actions={
          // Files has no tab; the longer pieces Dash wrote are reached from here and from each goal.
          <Link
            href="/goals/files"
            className="inline-flex items-center gap-1.5 text-small text-ink-muted underline-offset-2 hover:text-ink hover:underline"
          >
            <FileText className="size-3.5" strokeWidth={1.75} aria-hidden />
            Files
          </Link>
        }
      />
      <GoalsView
        areas={groupGoals(areas, goals)}
        view={view}
        onYou={Object.fromEntries(onYou)}
        progress={progress}
        areaRuns={areaRunViews(runs)}
        rhythms={rhythms}
        canRun={canRun}
      />
    </div>
  );
}
