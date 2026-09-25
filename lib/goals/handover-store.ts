import 'server-only';

import type { RoutineTarget } from '@/lib/feedback/routine';
import { loadCollectionsForGoal } from '@/lib/goals/collections-store';
import type { GoalsSupabaseClient } from '@/lib/goals/db/schema-name';
import {
  jobFor,
  locateStep,
  sendRefusal,
  sendRunText,
  type LiveRun,
  type SendJob,
  type SendMode,
  type SendTarget,
} from '@/lib/goals/handover';
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
  | { ok: true; job: SendJob; title: string; runId: string }
  /**
   * `refused` is set when the step itself cannot be sent, as against the fire
   * having failed; the night tick tries its next step on one and not the other.
   */
  | { ok: false; error: string; refused?: true };

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

/**
 * Every started run, on anything a send might overlap. The sweep closes quiet
 * ones (plan #1002), so these are few; sendRefusal drops any that went quiet
 * since the last tick.
 */
async function loadLiveRuns(client: GoalsSupabaseClient, userId: string): Promise<LiveRun[]> {
  const { data, error } = await client
    .from('runs')
    .select('item_id, job, created_at, last_seen_at')
    .eq('user_id', userId)
    .eq('status', 'started');
  if (error) throw new Error(`Could not read runs: ${error.message}`);
  return (data ?? []).map((row) => ({
    itemId: row.item_id as string | null,
    job: row.job as string,
    createdAt: row.created_at as string,
    lastSeenAt: row.last_seen_at as string | null,
  }));
}

/**
 * Send one step or phase to Claude, or with `mode` `prepare` ask Claude to
 * prepare one of your steps (plan #1001): refuse it with the reason, or write
 * the run row and fire the goals routine with the step's brief.
 */
export async function sendGoalStep(input: {
  client: GoalsSupabaseClient;
  userId: string;
  stepId: string;
  routine: RoutineTarget;
  mode?: SendMode;
  /** The @dash comment that asked for it (plan #1003), passed into the brief. */
  asked?: string;
  now?: number;
  fetch?: typeof globalThis.fetch;
}): Promise<SendResult> {
  const { client, userId, stepId } = input;
  const now = input.now ?? Date.now();

  const target = await loadTarget(client, userId, stepId);
  if (!target) return { ok: false, error: 'That step is no longer on the page.', refused: true };

  const mode = input.mode ?? 'send';
  const refused = sendRefusal(target, await loadLiveRuns(client, userId), now, mode);
  if (refused) return { ok: false, error: refused, refused: true };
  // sendRefusal has already turned away a step with no job.
  const job = jobFor(target.step, mode) as SendJob;

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
    text: (runId) => sendRunText({ target, job, collections, userId, runId, asked: input.asked }),
  });
  if (!fired.ok) return { ok: false, error: fired.error };
  return { ok: true, job, title: target.step.title, runId: fired.runId };
}
