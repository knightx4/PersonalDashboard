import 'server-only';

import { z } from 'zod';
import { goalsRoutine, type RoutineTarget } from '@/lib/feedback/routine';
import { outOfDateSteps } from '@/lib/goals/answers';
import { loadOutOfDateAnswers } from '@/lib/goals/answers-store';
import { DAILY_STEP_LIMIT, dailyRunText, ranRecently, readyClaudeSteps } from '@/lib/goals/daily-run';
import type { GoalsSupabaseClient } from '@/lib/goals/db/schema-name';
import { reviewGoals } from '@/lib/goals/reviews';
import { loadGoalActivity, loadLatestReviews } from '@/lib/goals/reviews-store';
import { recordAndFire } from '@/lib/goals/shaping-store';
import { accountToday, loadLiveTree } from '@/lib/goals/steps-store';
import { createGoalsServiceSupabase } from '@/inngest/goals/supabase-admin';

/**
 * The morning goals run (docs/GOALS-SPEC.md, "What Claude does, and when";
 * plan #933), a stage of the daily cron.
 *
 * Fires the goals routine once for the owner each morning while there is an
 * open goal, with the run row written first. The brief lists every open goal
 * to give its status for the day (plan #1074), then the Claude steps that are
 * ready and the information steps with an answer out of date (plan #989). A
 * status is never more than a day old because this run writes one every day,
 * so it no longer waits for a ready step. It starts nothing when the routine
 * is not set on the deployment, when a morning run already started in the
 * last twenty hours, or when there is no open goal and nothing to work,
 * because each run spends the owner's routine allowance. A fire that fails
 * throws, so the cron reports the stage as failed.
 *
 * The owner only: goals are personal, and the allowance the run spends is
 * the owner's.
 */

export type GoalsDailyResult =
  | { skipped: string }
  | {
      started: true;
      runId: string;
      /** Open goals given a status. */
      reviewed: number;
      steps: number;
      held: number;
      answers: number;
    };

export type GoalsDailyDeps = {
  client: GoalsSupabaseClient;
  routine: RoutineTarget;
  now: number;
  fetch?: typeof globalThis.fetch;
};

const ownerSchema = z.object({ userId: z.string().uuid() });

export async function runGoalsDaily(deps?: Partial<GoalsDailyDeps>): Promise<GoalsDailyResult> {
  const routine = deps?.routine ?? goalsRoutine();
  if (!routine.id) return { skipped: 'CLAUDE_GOALS_ROUTINE_ID is not set' };
  const client = deps?.client ?? createGoalsServiceSupabase();
  const now = deps?.now ?? Date.now();

  const owner = await client.schema('public').rpc('app_owner');
  const parsed = ownerSchema.safeParse(owner.data);
  if (owner.error || !parsed.success) throw new Error('Could not resolve the owner to run goals for.');
  const userId = parsed.data.userId;

  const last = await client
    .from('runs')
    .select('created_at')
    .eq('user_id', userId)
    .eq('job', 'daily')
    .order('created_at', { ascending: false })
    .limit(1);
  if (last.error) throw new Error(`Could not read goals runs: ${last.error.message}`);
  const lastAt = (last.data?.[0]?.created_at as string | undefined) ?? null;
  if (ranRecently(lastAt, now)) return { skipped: 'a morning run already started today' };

  // A step whose start date has not come is left for a later morning.
  const today = await accountToday(client, userId, now);
  const [{ goals, byGoal }, stale, activity, latest] = await Promise.all([
    loadLiveTree(client, { userId, today }),
    loadOutOfDateAnswers(client, userId),
    loadGoalActivity(client, userId),
    loadLatestReviews(client, { userId, now }),
  ]);
  const review = reviewGoals(
    goals.map((g) => g.goal),
    activity,
    latest,
    now,
  );
  const ready = readyClaudeSteps(
    goals.map((g) => g.goal),
    byGoal,
  );
  const answers = outOfDateSteps(
    goals.map((g) => g.goal),
    byGoal,
    stale,
  );
  if (review.length === 0 && ready.length === 0 && answers.length === 0) {
    return { skipped: 'no open goal, no Claude step ready and no answer out of date' };
  }
  const steps = ready.slice(0, DAILY_STEP_LIMIT);

  const result = await recordAndFire({
    client,
    userId,
    job: 'daily',
    itemId: null,
    routine,
    text: (runId) => dailyRunText({ userId, runId, steps, answers, review }),
    fetch: deps?.fetch,
  });
  // Thrown so the cron reports the stage as failed. The run row, when there
  // is one, already says failed with the reason.
  if (!result.ok) {
    throw new Error(`The morning goals run did not start (run ${result.runId ?? 'not recorded'}): ${result.error}`);
  }
  return {
    started: true,
    runId: result.runId,
    reviewed: review.length,
    steps: steps.length,
    held: ready.length - steps.length,
    answers: answers.length,
  };
}
