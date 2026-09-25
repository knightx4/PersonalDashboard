import 'server-only';

import type { RoutineTarget } from '@/lib/feedback/routine';
import { loadCollectionsForGoal } from '@/lib/goals/collections-store';
import type { GoalsSupabaseClient } from '@/lib/goals/db/schema-name';
import {
  locateStep,
  sendJob,
  sendRefusal,
  sendRunText,
  type LiveRun,
  type SendTarget,
} from '@/lib/goals/handover';
import { RUN_QUIET_MS } from '@/lib/goals/shaping';
import { recordAndFire } from '@/lib/goals/shaping-store';
import { loadLiveTree } from '@/lib/goals/steps-store';

/**
 * The reads and the fire behind Send on a goal step or phase (plan #1000).
 * The rules are in lib/goals/handover.ts; this reads what they need, asks
 * them, and fires through recordAndFire so the run row is written first and
 * its id is in the brief.
 *
 * `userId` narrows the reads for a service-role client, as loadLiveTree's
 * does, so a later caller without a signed-in session (the night run, an
 * @dash reply) can use the same hand-over.
 */

export type SendResult =
  | { ok: true; job: 'step' | 'phase'; title: string; runId: string }
  | { ok: false; error: string };

/** The step, its goal, and whether that goal is approved; null when it is not a live step. */
async function loadTarget(
  client: GoalsSupabaseClient,
  userId: string,
  stepId: string,
): Promise<SendTarget | null> {
  const { goals, byGoal } = await loadLiveTree(client, { userId });
  for (const { goal } of goals) {
    const located = locateStep(
      { id: goal.id, title: goal.title, acceptance: goal.acceptance, status: goal.status, approvedAt: null },
      byGoal.get(goal.id) ?? [],
      stepId,
    );
    if (!located) continue;
    const { data, error } = await client
      .from('items')
      .select('approved_at')
      .eq('id', goal.id)
      .eq('user_id', userId)
      .maybeSingle();
    if (error) throw new Error(`Could not read the goal: ${error.message}`);
    return { ...located, goal: { ...located.goal, approvedAt: (data?.approved_at as string | null) ?? null } };
  }
  return null;
}

/** Started runs young enough to still be going, on anything a send might overlap. */
async function loadLiveRuns(client: GoalsSupabaseClient, userId: string, now: number): Promise<LiveRun[]> {
  const { data, error } = await client
    .from('runs')
    .select('item_id, job, created_at')
    .eq('user_id', userId)
    .eq('status', 'started')
    .gte('created_at', new Date(now - RUN_QUIET_MS).toISOString());
  if (error) throw new Error(`Could not read runs: ${error.message}`);
  return (data ?? []).map((row) => ({
    itemId: row.item_id as string | null,
    job: row.job as string,
    createdAt: row.created_at as string,
  }));
}

/**
 * Send one step or phase to Claude: refuse it with the reason, or write the
 * run row and fire the goals routine with the step's brief.
 */
export async function sendGoalStep(input: {
  client: GoalsSupabaseClient;
  userId: string;
  stepId: string;
  routine: RoutineTarget;
  now?: number;
  fetch?: typeof globalThis.fetch;
}): Promise<SendResult> {
  const { client, userId, stepId } = input;
  const now = input.now ?? Date.now();

  const target = await loadTarget(client, userId, stepId);
  if (!target) return { ok: false, error: 'That step is no longer on the page.' };

  const refused = sendRefusal(target, await loadLiveRuns(client, userId, now), now);
  if (refused) return { ok: false, error: refused };
  // sendRefusal has already turned away a step with no job.
  const job = sendJob(target.step) as 'step' | 'phase';

  const collections = (await loadCollectionsForGoal(client, target.goal.id)).map((c) => ({
    id: c.id,
    name: c.name,
    fields: c.fields.map((field) => field.key),
  }));

  const fired = await recordAndFire({
    client,
    userId,
    job,
    itemId: target.step.id,
    routine: input.routine,
    fetch: input.fetch,
    text: (runId) => sendRunText({ target, job, collections, userId, runId }),
  });
  if (!fired.ok) return { ok: false, error: fired.error };
  return { ok: true, job, title: target.step.title, runId: fired.runId };
}
