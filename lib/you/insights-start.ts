import { fireFeatureRoutine, type RoutineTarget } from '@/lib/feedback/routine';
import type { YouSupabaseClient } from '@/lib/you/db/schema-name';
import { insightsBrief, type InsightRunReason } from '@/lib/you/insights';
import { INSIGHT_RUN_STALE_AFTER_MS, STALE_RUN_ERROR } from '@/lib/you/insights-run';

/**
 * Queue an insights run: a row the tab shows running at once (plan #2413.10).
 * Look again and the monthly tick both begin here. A run
 * left queued or running past the stale mark is marked failed before the
 * check, so a session that died does not hold the next one; the partial
 * unique index allows one open run at a time.
 */
export type QueueInsightRunResult =
  | { queued: true; runId: string }
  | { queued: false; reason: 'running' | 'error'; error: string };

export async function queueInsightRun(input: {
  client: YouSupabaseClient;
  userId: string;
  now?: number;
}): Promise<QueueInsightRunResult> {
  const { client, userId } = input;
  const now = input.now ?? Date.now();
  await client
    .from('insight_runs')
    .update({ status: 'failed', error: STALE_RUN_ERROR, finished_at: new Date(now).toISOString() })
    .eq('user_id', userId)
    .in('status', ['queued', 'running'])
    .lt('requested_at', new Date(now - INSIGHT_RUN_STALE_AFTER_MS).toISOString());

  const { data: row, error } = await client
    .from('insight_runs')
    .insert({ user_id: userId, status: 'queued' })
    .select('id')
    .single();
  if (error?.code === '23505') return { queued: false, reason: 'running', error: 'Dash is already looking again.' };
  if (error || !row) return { queued: false, reason: 'error', error: error?.message ?? 'Could not start the run.' };
  return { queued: true, runId: row.id as string };
}

/**
 * Start one insights run on the goals routine (plan #2413.6): a session on the
 * person's plan that follows the insights skill and reads everything. Look
 * again and the monthly tick both start here. The single API call
 * (inngest/you/insights-write.ts) wrote shallower cards from extracts and is
 * no longer started by either.
 *
 * The run row is made first, queued, so the tab shows it at once; the goals
 * routine is then fired with the insights brief naming it. A run left queued
 * or running past the stale mark is marked failed before the check, so a
 * session that died does not hold the next one. A fire that fails marks the
 * new row failed with the answer, which is what the tab then shows.
 *
 * `client` is the person's own session or the service role; either way every
 * query names the user.
 */
export type StartInsightRunResult =
  | { started: true; runId: string }
  | { started: false; reason: 'running' | 'no_routine' | 'error'; error: string };

export async function startInsightRun(input: {
  client: YouSupabaseClient;
  userId: string;
  reason: InsightRunReason;
  change?: string | null;
  routine: RoutineTarget;
  now?: number;
  fetch?: typeof globalThis.fetch;
}): Promise<StartInsightRunResult> {
  const { client, userId, routine } = input;
  if (!routine.id || !routine.token) {
    return {
      started: false,
      reason: 'no_routine',
      error:
        'Insights run on the goals routine, which is not set up on this deployment: it needs CLAUDE_GOALS_ROUTINE_ID and CLAUDE_GOALS_ROUTINE_TOKEN.',
    };
  }
  const queued = await queueInsightRun({ client, userId, now: input.now });
  if (!queued.queued) return { started: false, reason: queued.reason, error: queued.error };
  const runId = queued.runId;

  const fired = await fireFeatureRoutine({
    apiKey: routine.token,
    routineId: routine.id,
    text: insightsBrief({ runId, userId, reason: input.reason, change: input.change }),
    fetch: input.fetch,
  });

  if (!fired.ok) {
    await client
      .from('insight_runs')
      .update({ status: 'failed', error: `Dash could not start the run. ${fired.error}`.slice(0, 2000) })
      .eq('id', runId)
      .eq('user_id', userId);
    return { started: false, reason: 'error', error: fired.error };
  }

  const body = fired.body as Record<string, unknown> | null;
  const runUrl = typeof body?.claude_code_session_url === 'string' ? body.claude_code_session_url : null;
  if (runUrl) {
    await client.from('insight_runs').update({ run_url: runUrl.slice(0, 500) }).eq('id', runId).eq('user_id', userId);
  }
  return { started: true, runId };
}
