import 'server-only';

import { createClient } from '@/lib/auth/server';
import { loadPlanForRequest } from '@/lib/plan/request-plan';
import { buildPlanTree } from '@/lib/plan/tree';
import { loadFeatureFires, loadLastRuns, loadStartedRuns } from '@/lib/plan/runs';
import { loadOvernightRun } from '@/lib/plan/overnight';
import { runnerCard } from '@/lib/plan/runner-card';
import { runnerSlots, type RunnerSlot } from '@/lib/plan/overnight-slots';
import { createGoalsClient } from '@/lib/goals/auth/server';
import { loadStartedGoalRuns } from '@/lib/goals/runs-store';
import { goalsReadyLine, goalsStatus } from '@/lib/goals/runner-status';
import { loadGoalsNight } from '@/inngest/goals/overnight';

/** The goal runs going and the goals night's rows, or null when they could not be read. */
async function readGoals(userId: string, now: number) {
  try {
    const client = await createGoalsClient();
    const [started, night] = await Promise.all([
      loadStartedGoalRuns(client),
      loadGoalsNight(client, userId, now),
    ]);
    return { started, night };
  } catch {
    return null;
  }
}

/**
 * The runner's four slots, as the plan page's runner card draws them, for the
 * status line on every page.
 *
 * Read with the same loaders and the same `runnerCard` and `runnerSlots` the
 * card uses, so the four Dashes at the foot of a page cannot say something
 * different from the four on /dev/plan. It is the plan page's read, too heavy
 * to hold up every page's render, so the status line asks for it from the
 * browser once the page has drawn (app/api/plan/crew/route.ts).
 */
export async function loadRunnerSlots(userId: string): Promise<RunnerSlot[]> {
  const supabase = await createClient();
  const now = Date.now();
  const goalsRead = readGoals(userId, now);
  const [plan, overnight, fires, lastRuns, started] = await Promise.all([
    loadPlanForRequest(userId),
    loadOvernightRun(supabase, userId),
    loadFeatureFires(supabase, userId),
    loadLastRuns(supabase, userId),
    loadStartedRuns(supabase, userId),
  ]);

  const card = runnerCard({
    run: overnight,
    fires,
    items: plan.items,
    sections: buildPlanTree(plan),
    started,
    lastRuns: Object.values(lastRuns),
    now,
  });

  const goalsRows = await goalsRead;
  const goals = goalsRows
    ? goalsStatus({
        ...goalsRows,
        nightStartedAt: overnight?.running ? overnight.startedAt : null,
        now,
      })
    : null;
  const goalOn = goals?.on[0] ?? null;

  // The same goals seat the runner card builds (app/dev/plan/overnight-control.tsx).
  return runnerSlots({
    run: overnight,
    sessions: card.sessions,
    goalRun: goalOn
      ? {
          startedAt: goalOn.at,
          title: goalOn.title ? `${goalOn.doing}: ${goalOn.title}` : goalOn.doing,
          doing: goalOn.nowOn,
        }
      : null,
    goalsReason: (goals ? goalsReadyLine(goals) : null) ?? 'No goal step is ready.',
    now,
  });
}
