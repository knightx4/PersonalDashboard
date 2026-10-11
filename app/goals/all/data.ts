import 'server-only';

import { createClient } from '@/lib/auth/server';
import type { SessionUser } from '@/lib/auth/session-user';
import { loadAccountSettings } from '@/lib/core/account/settings';
import { isOwner } from '@/lib/dev/owner';
import { onYouByGoal, type AllGoalsView } from '@/lib/goals/all-goals';
import { createGoalsClient } from '@/lib/goals/auth/server';
import { areaRunView, type AreaRunView } from '@/lib/goals/shaping';
import { loadAreaRuns } from '@/lib/goals/shaping-store';
import { loadAreas, loadGoals } from '@/lib/goals/store';
import { goalProgress, type GoalProgress } from '@/lib/goals/status';
import { loadLiveTree } from '@/lib/goals/steps-store';
import { todayRanked } from '@/lib/goals/today';
import { loadTodayInput } from '@/lib/goals/today-store';
import { groupGoals, type AreaWithGoals } from '@/lib/goals/tree';
import { liveRhythms, missedLine, practices, progressLine } from '@/lib/goals/rhythms';
import { syncRhythms } from '@/lib/goals/rhythms-store';
import { todayIn } from '@/lib/todo/tasks/model';
import type { AreaRhythm } from '../goals-view';

/**
 * What All goals and an area's own page draw (plan #1619): every area with
 * its goals, how many things on you each goal holds, each goal's bar, each
 * area's latest Plan this area run and its rhythms. The area page narrows it
 * to one area, so both read the same way and edit the same rows.
 */
export type AllGoalsData = {
  areas: AreaWithGoals[];
  onYou: Record<string, number>;
  progress: Record<string, GoalProgress>;
  areaRuns: Record<string, AreaRunView>;
  rhythms: Record<string, AreaRhythm[]>;
  canRun: boolean;
};

/** Each area's latest run as its line reads it. Outside the component because it reads the clock. */
function areaRunViews(runs: Awaited<ReturnType<typeof loadAreaRuns>>): Record<string, AreaRunView> {
  const now = Date.now();
  return Object.fromEntries(Object.entries(runs).map(([id, run]) => [id, areaRunView(run, now)]));
}

/**
 * Each area's rhythms with this period's progress, keyed by area id.
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

export async function loadAllGoals(user: SessionUser, view: AllGoalsView): Promise<AllGoalsData> {
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
  return {
    areas: groupGoals(areas, goals),
    onYou: Object.fromEntries(onYou),
    progress,
    areaRuns: areaRunViews(runs),
    rhythms,
    canRun,
  };
}
