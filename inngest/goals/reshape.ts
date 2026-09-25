import 'server-only';

import { z } from 'zod';
import { goalsRoutine, type RoutineTarget } from '@/lib/feedback/routine';
import type { GoalsSupabaseClient } from '@/lib/goals/db/schema-name';
import {
  RESHAPE_GOAL_LIMIT,
  RESHAPE_LOOKBACK_MS,
  goalsToReshape,
  reshapeRunText,
  type Answer,
  type GoalRunStamp,
} from '@/lib/goals/reshape-run';
import { recordAndFire } from '@/lib/goals/shaping-store';
import { loadLiveTree } from '@/lib/goals/steps-store';
import { createGoalsServiceSupabase } from '@/inngest/goals/supabase-admin';

/**
 * The re-shape tick (plan #1017), called every ten minutes by pg_cron
 * (supabase/migrations-goals/0018_reshape_runs.sql).
 *
 * Reads the answers given to questions in the last two days from
 * goals.history, and fires the goals routine once for each goal with an
 * answer newer than its last run, once that answer is ten minutes old. The
 * run row is written first with job `reshape`, as for the other goal runs.
 * A tick with nothing answered lately is one read of history and no fire.
 *
 * The owner only: goals are personal, and the allowance each run spends is
 * the owner's. A fire that fails is recorded on its run row and reported in
 * the result; the other goals still fire.
 */

export type GoalsReshapeResult =
  | { skipped: string }
  | { started: string[]; failed: { goalId: string; error: string }[]; held: number };

export type GoalsReshapeDeps = {
  client: GoalsSupabaseClient;
  routine: RoutineTarget;
  now: number;
  fetch?: typeof globalThis.fetch;
};

const ownerSchema = z.object({ userId: z.string().uuid() });

/** How many answer rows one tick reads; far past two days of answering. */
const ANSWER_LIMIT = 500;

export async function runGoalsReshape(deps?: Partial<GoalsReshapeDeps>): Promise<GoalsReshapeResult> {
  const routine = deps?.routine ?? goalsRoutine();
  if (!routine.id) return { skipped: 'CLAUDE_GOALS_ROUTINE_ID is not set' };
  const client = deps?.client ?? createGoalsServiceSupabase();
  const now = deps?.now ?? Date.now();

  const owner = await client.schema('public').rpc('app_owner');
  const parsed = ownerSchema.safeParse(owner.data);
  if (owner.error || !parsed.success) throw new Error('Could not resolve the owner to run goals for.');
  const userId = parsed.data.userId;
  const since = new Date(now - RESHAPE_LOOKBACK_MS).toISOString();

  // An answer is an update to an item that sets its resolution. History
  // keeps only the changed columns on an update, so the key is there exactly
  // when the answer was written or changed.
  const history = await client
    .from('history')
    .select('row_id, created_at')
    .eq('user_id', userId)
    .eq('table_name', 'items')
    .eq('action', 'update')
    .not('new_values->resolution', 'is', null)
    .gte('created_at', since)
    .order('created_at', { ascending: false })
    .limit(ANSWER_LIMIT);
  if (history.error) throw new Error(`Could not read goals history: ${history.error.message}`);
  const answers: Answer[] = (history.data ?? []).map((row) => ({
    questionId: row.row_id as string,
    answeredAt: row.created_at as string,
  }));
  if (answers.length === 0) return { skipped: 'no questions answered lately' };

  const runs = await client
    .from('runs')
    .select('item_id, status, created_at, last_seen_at')
    .eq('user_id', userId)
    .in('job', ['goal', 'reshape'])
    .not('item_id', 'is', null)
    .gte('created_at', since);
  if (runs.error) throw new Error(`Could not read goals runs: ${runs.error.message}`);
  const stamps: GoalRunStamp[] = (runs.data ?? []).map((row) => ({
    itemId: row.item_id as string,
    status: row.status as string,
    createdAt: row.created_at as string,
    lastSeenAt: row.last_seen_at as string | null,
  }));

  const { goals, byGoal } = await loadLiveTree(client, { userId });
  const due = goalsToReshape({
    goals: goals.map((g) => g.goal),
    stepsByGoal: byGoal,
    answers,
    runs: stamps,
    now,
  });
  if (due.length === 0) return { skipped: 'no goal has an answer waiting to be worked in' };

  const started: string[] = [];
  const failed: { goalId: string; error: string }[] = [];
  for (const goal of due.slice(0, RESHAPE_GOAL_LIMIT)) {
    const result = await recordAndFire({
      client,
      userId,
      job: 'reshape',
      itemId: goal.goalId,
      routine,
      text: (runId) => reshapeRunText({ userId, runId, goal }),
      fetch: deps?.fetch,
    });
    if (result.ok) started.push(result.runId);
    else failed.push({ goalId: goal.goalId, error: result.error });
  }
  return { started, failed, held: Math.max(0, due.length - RESHAPE_GOAL_LIMIT) };
}
