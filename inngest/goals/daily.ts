import 'server-only';

import { z } from 'zod';
import { goalsRoutine, type RoutineTarget } from '@/lib/feedback/routine';
import { outOfDateSteps } from '@/lib/goals/answers';
import { loadOutOfDateAnswers } from '@/lib/goals/answers-store';
import { DAILY_STEP_LIMIT, dailyRunText, ranRecently, readyClaudeSteps } from '@/lib/goals/daily-run';
import type { GoalsSupabaseClient } from '@/lib/goals/db/schema-name';
import { recordAndFire } from '@/lib/goals/shaping-store';
import { accountToday, loadLiveTree } from '@/lib/goals/steps-store';
import { createGoalsServiceSupabase } from '@/inngest/goals/supabase-admin';

/**
 * The morning goals run (docs/GOALS-SPEC.md, "What Claude does, and when";
 * plan #933), a stage of the daily cron.
 *
 * Fires the goals routine once for the owner when a Claude step is ready or
 * an information step has an answer out of date (plan #989), with the run
 * row written first and both named in its brief. It starts nothing when the
 * routine is not set on the deployment, when a morning run already started
 * in the last twenty hours, or when there is neither, because each run
 * spends the owner's routine allowance. A
 * fire that fails throws, so the cron reports the stage as failed.
 *
 * The owner only: goals are personal, and the allowance the run spends is
 * the owner's.
 */

export type GoalsDailyResult =
  | { skipped: string }
  | { started: true; runId: string; steps: number; held: number; answers: number };

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
  const [{ goals, byGoal }, stale] = await Promise.all([
    loadLiveTree(client, { userId, today }),
    loadOutOfDateAnswers(client, userId),
  ]);
  const ready = readyClaudeSteps(
    goals.map((g) => g.goal),
    byGoal,
  );
  const answers = outOfDateSteps(
    goals.map((g) => g.goal),
    byGoal,
    stale,
  );
  if (ready.length === 0 && answers.length === 0) {
    return { skipped: 'no Claude steps are ready and no answers are out of date' };
  }
  const steps = ready.slice(0, DAILY_STEP_LIMIT);

  const result = await recordAndFire({
    client,
    userId,
    job: 'daily',
    itemId: null,
    routine,
    text: (runId) => dailyRunText({ userId, runId, steps, answers }),
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
    steps: steps.length,
    held: ready.length - steps.length,
    answers: answers.length,
  };
}
