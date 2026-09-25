import 'server-only';

import { fireFeatureRoutine, resolveRoutineId, type RoutineTarget } from '@/lib/feedback/routine';
import type { GoalsSupabaseClient } from '@/lib/goals/db/schema-name';
import type { RunJob } from '@/lib/goals/runs';
import { areaRunText, goalRunText, type GoalRun } from '@/lib/goals/shaping';

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
  last_seen_at: string | null;
  now_on: string | null;
};

const ERROR_LIMIT = 4000;

/**
 * When the goal was approved (null if not yet) and the latest run on it,
 * which decides whether another may start. The goal page lists the goal's
 * runs itself (plan #1014), and each run's page says what it changed.
 */
export async function loadShaping(
  client: GoalsSupabaseClient,
  goalId: string,
): Promise<{ approvedAt: string | null; lastRun: GoalRun | null }> {
  const [goal, runs] = await Promise.all([
    client.from('items').select('approved_at').eq('id', goalId).eq('level', 'goal').maybeSingle(),
    client
      .from('runs')
      .select('id, status, created_at, ended_at, summary, error, last_seen_at, now_on')
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
      lastSeenAt: row.last_seen_at,
      nowOn: row.now_on,
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
}): Promise<{ ok: true; detail: string; runId: string } | { ok: false; error: string }> {
  const { goal, userId } = input;
  const result = await recordAndFire({
    ...input,
    job: 'goal',
    itemId: goal.id,
    text: (runId) => goalRunText({ goalId: goal.id, goalTitle: goal.title, userId, runId }),
  });
  return result.ok
    ? { ok: true, detail: result.detail, runId: result.runId }
    : { ok: false, error: result.error };
}

/**
 * The latest run on each area, keyed by area id, for the Plan this area
 * button and the line beside it. An area with no run is absent.
 */
export async function loadAreaRuns(client: GoalsSupabaseClient): Promise<Record<string, GoalRun>> {
  const { data, error } = await client
    .from('runs')
    .select('id, area_id, status, created_at, ended_at, summary, error, last_seen_at, now_on')
    .eq('job', 'area')
    .not('area_id', 'is', null)
    .order('created_at', { ascending: false })
    .limit(200);
  if (error) throw new Error(`Could not read area runs: ${error.message}`);
  const latest: Record<string, GoalRun> = {};
  for (const row of (data ?? []) as (RunRow & { area_id: string })[]) {
    if (latest[row.area_id]) continue;
    latest[row.area_id] = {
      id: row.id,
      status: row.status,
      createdAt: row.created_at,
      endedAt: row.ended_at,
      summary: row.summary,
      error: row.error,
      lastSeenAt: row.last_seen_at,
      nowOn: row.now_on,
    };
  }
  return latest;
}

/**
 * Plan this area: the run row on the area, then the fire with a brief naming
 * the area, its note and the goals already under it.
 */
export async function startAreaRun(input: {
  client: GoalsSupabaseClient;
  userId: string;
  area: { id: string; name: string; note: string | null };
  goals: { title: string; status: string }[];
  routine: RoutineTarget;
  fetch?: typeof globalThis.fetch;
}): Promise<{ ok: true; detail: string } | { ok: false; error: string }> {
  const { area, goals, userId } = input;
  const result = await recordAndFire({
    ...input,
    job: 'area',
    itemId: null,
    areaId: area.id,
    text: (runId) =>
      areaRunText({ areaId: area.id, areaName: area.name, note: area.note, goals, userId, runId }),
  });
  return result.ok ? { ok: true, detail: result.detail } : { ok: false, error: result.error };
}

/**
 * The run row and the fire, for any job: "Work on this" on one goal, the
 * morning run (plan #933), the weekly run, a re-shape after answers
 * (plan #1017), one step or phase sent from its row (plan #1000), or an
 * area (Plan this area). `text` is the brief, given the new run's id. The
 * run id comes back either way, null only when the row itself could not be
 * written and nothing was started.
 */
export async function recordAndFire(input: {
  client: GoalsSupabaseClient;
  userId: string;
  job: RunJob;
  itemId: string | null;
  /** The area an area run is on; every other job leaves it out. */
  areaId?: string | null;
  routine: RoutineTarget;
  text: (runId: string) => string;
  fetch?: typeof globalThis.fetch;
}): Promise<
  { ok: true; detail: string; runId: string } | { ok: false; error: string; runId: string | null }
> {
  const { client, userId, routine } = input;
  const { data, error } = await client
    .from('runs')
    .insert({
      user_id: userId,
      job: input.job,
      item_id: input.itemId,
      area_id: input.areaId ?? null,
      status: 'started',
      routine_id: resolveRoutineId(routine.id),
    })
    .select('id')
    .single();
  if (error || !data) {
    return { ok: false, error: 'The run could not be recorded, so nothing was started.', runId: null };
  }
  const runId = data.id as string;

  const result = await fireFeatureRoutine({
    apiKey: routine.token,
    routineId: routine.id,
    text: input.text(runId),
    fetch: input.fetch,
  });

  const update = result.ok
    ? { external_id: result.runId?.slice(0, 200) ?? null }
    : {
        status: 'failed',
        error: result.error.slice(0, ERROR_LIMIT),
        ended_at: new Date().toISOString(),
      };
  const written = await client.from('runs').update(update).eq('id', runId).eq('user_id', userId);
  if (written.error) {
    console.error(`goals.runs update failed for run ${runId}: ${written.error.message}`);
  }

  return result.ok
    ? { ok: true, detail: result.detail, runId }
    : { ok: false, error: result.error, runId };
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
 * Answer a question step, or change the answer it already has (plan #956):
 * the answer goes in its resolution, the step closes, and a question put
 * aside comes back into view. A change is an update like any other, so the
 * history trigger keeps the answer it replaced. False when it is not a live
 * question, or it was withdrawn.
 */
export async function answerQuestion(
  client: GoalsSupabaseClient,
  id: string,
  answer: string,
): Promise<boolean> {
  const { data, error } = await client
    .from('items')
    .update({ resolution: answer, status: 'done', dismissed_at: null })
    .eq('id', id)
    .eq('level', 'step')
    .eq('kind', 'decision')
    .neq('status', 'dropped')
    .is('archived_at', null)
    .select('id');
  if (error) throw new Error(error.message);
  return (data ?? []).length > 0;
}

/**
 * Put an unanswered question aside with Not now, or bring it back (plan
 * #956). It stays open and unanswered either way. False when it is not a
 * live, unanswered question.
 */
export async function setQuestionAside(
  client: GoalsSupabaseClient,
  id: string,
  aside: boolean,
): Promise<boolean> {
  const { data, error } = await client
    .from('items')
    .update({ dismissed_at: aside ? new Date().toISOString() : null })
    .eq('id', id)
    .eq('level', 'step')
    .eq('kind', 'decision')
    .is('resolution', null)
    .is('archived_at', null)
    .select('id');
  if (error) throw new Error(error.message);
  return (data ?? []).length > 0;
}

/**
 * Mark what Claude produced for a step as read (plan #933), which takes it
 * off the home's waiting list. False when there is no unread result on it.
 */
export async function markReviewed(client: GoalsSupabaseClient, id: string): Promise<boolean> {
  const { data, error } = await client
    .from('items')
    .update({ reviewed_at: new Date().toISOString() })
    .eq('id', id)
    .eq('kind', 'claude')
    .is('reviewed_at', null)
    .or('result.not.is.null,result_url.not.is.null')
    .select('id');
  if (error) throw new Error(error.message);
  return (data ?? []).length > 0;
}

/**
 * Approve or turn down one proposed step (plan #960), with the proposed
 * steps beneath it; turning one down also drops any unanswered question
 * beneath it. The goal's other proposals keep waiting. Null when it is not a
 * live proposed step of yours, otherwise how many rows it changed.
 */
export async function settleProposal(
  client: GoalsSupabaseClient,
  id: string,
  approve: boolean,
): Promise<number | null> {
  const { data, error } = await client.rpc('settle_proposal', { step: id, approve });
  if (error) throw new Error(error.message);
  return data === null ? null : Number(data);
}

/**
 * Put a goal's fog aside with Not now, or bring it back (plan #960). The fog
 * itself is untouched, and rewriting it brings it back on its own. False when
 * it is not a live goal of yours with fog on it.
 */
export async function setFogAside(
  client: GoalsSupabaseClient,
  goalId: string,
  aside: boolean,
): Promise<boolean> {
  const { data, error } = await client
    .from('items')
    .update({ fog_dismissed_at: aside ? new Date().toISOString() : null })
    .eq('id', goalId)
    .eq('level', 'goal')
    .not('fog', 'is', null)
    .is('archived_at', null)
    .select('id');
  if (error) throw new Error(error.message);
  return (data ?? []).length > 0;
}
