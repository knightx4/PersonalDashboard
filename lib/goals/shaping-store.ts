import 'server-only';

import { fireFeatureRoutine, resolveRoutineId, type RoutineTarget } from '@/lib/feedback/routine';
import type { GoalsSupabaseClient } from '@/lib/goals/db/schema-name';
import { goalRunText, type GoalRun } from '@/lib/goals/shaping';

/**
 * Reads and writes for Claude shaping a goal (plan #932): the latest run on a
 * goal, starting one, approving a goal, and answering a question Claude
 * asked. Every call takes the signed-in goals client, so row level security
 * decides whose rows these are and the history trigger records each change.
 */

type RunRow = {
  id: string;
  status: GoalRun['status'];
  created_at: string;
  ended_at: string | null;
  summary: string | null;
  error: string | null;
};

const ERROR_LIMIT = 4000;

/** When the goal was approved (null if not yet) and the latest run on it. */
export async function loadShaping(
  client: GoalsSupabaseClient,
  goalId: string,
): Promise<{ approvedAt: string | null; lastRun: GoalRun | null }> {
  const [goal, runs] = await Promise.all([
    client.from('items').select('approved_at').eq('id', goalId).eq('level', 'goal').maybeSingle(),
    client
      .from('runs')
      .select('id, status, created_at, ended_at, summary, error')
      .eq('item_id', goalId)
      .order('created_at', { ascending: false })
      .limit(1),
  ]);
  if (goal.error) throw new Error(`Could not read the goal: ${goal.error.message}`);
  if (runs.error) throw new Error(`Could not read runs: ${runs.error.message}`);
  const row = (runs.data?.[0] ?? null) as RunRow | null;
  return {
    approvedAt: (goal.data?.approved_at as string | null) ?? null,
    lastRun: row && {
      id: row.id,
      status: row.status,
      createdAt: row.created_at,
      endedAt: row.ended_at,
      summary: row.summary,
      error: row.error,
    },
  };
}

/**
 * Write the run row, then fire the routine with its id, then record what the
 * fire said. The row goes first, unlike lib/plan/runs.ts, because the session
 * needs the run's id in its brief to label its changes and close the row.
 * A fire that fails leaves the row as failed with the reason, so a press that
 * started nothing is still on the record.
 */
export async function startGoalRun(input: {
  client: GoalsSupabaseClient;
  userId: string;
  goal: { id: string; title: string };
  routine: RoutineTarget;
  fetch?: typeof globalThis.fetch;
}): Promise<{ ok: true; detail: string } | { ok: false; error: string }> {
  const { client, userId, goal, routine } = input;
  const { data, error } = await client
    .from('runs')
    .insert({
      user_id: userId,
      job: 'goal',
      item_id: goal.id,
      status: 'started',
      routine_id: resolveRoutineId(routine.id),
    })
    .select('id')
    .single();
  if (error || !data) return { ok: false, error: 'The run could not be recorded, so nothing was started.' };
  const runId = data.id as string;

  const result = await fireFeatureRoutine({
    apiKey: routine.token,
    routineId: routine.id,
    text: goalRunText({ goalId: goal.id, goalTitle: goal.title, userId, runId }),
    fetch: input.fetch,
  });

  const update = result.ok
    ? { external_id: result.runId?.slice(0, 200) ?? null }
    : {
        status: 'failed',
        error: result.error.slice(0, ERROR_LIMIT),
        ended_at: new Date().toISOString(),
      };
  const written = await client.from('runs').update(update).eq('id', runId);
  if (written.error) {
    console.error(`goals.runs update failed for run ${runId}: ${written.error.message}`);
  }

  return result.ok ? { ok: true, detail: result.detail } : { ok: false, error: result.error };
}

/**
 * Approve a goal: it opens if Claude proposed it, and every proposed step
 * under it opens. Null when there is no live goal of yours with that id,
 * otherwise how many steps it opened.
 */
export async function approveGoal(client: GoalsSupabaseClient, goalId: string): Promise<number | null> {
  const { data, error } = await client.rpc('approve_goal', { goal: goalId });
  if (error) throw new Error(error.message);
  return data === null ? null : Number(data);
}

/**
 * Answer a question step: the answer goes in its resolution and the step
 * closes. False when it is not a live, unanswered question.
 */
export async function answerQuestion(
  client: GoalsSupabaseClient,
  id: string,
  answer: string,
): Promise<boolean> {
  const { data, error } = await client
    .from('items')
    .update({ resolution: answer, status: 'done' })
    .eq('id', id)
    .eq('level', 'step')
    .eq('kind', 'decision')
    .is('resolution', null)
    .is('archived_at', null)
    .select('id');
  if (error) throw new Error(error.message);
  return (data ?? []).length > 0;
}
