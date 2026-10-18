import { fireFeatureRoutine, type RoutineTarget } from '@/lib/feedback/routine';
import type { YouSupabaseClient } from '@/lib/you/db/schema-name';
import { insightsBrief, type InsightRunReason } from '@/lib/you/insights';
import { INSIGHT_RUN_STALE_AFTER_MS, STALE_RUN_ERROR } from '@/lib/you/insights-run';

/**
 * Start one insights run (plan #2413.6). The Look again button, the weekly
 * tick and the change trigger all come through here, so a run is queued,
 * fired and failed the same way whichever asked for it.
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
  // The partial unique index allows one run at a time.
  if (error?.code === '23505') {
    return { started: false, reason: 'running', error: 'Dash is already looking again.' };
  }
  if (error || !row) {
    return { started: false, reason: 'error', error: error?.message ?? 'Could not start the run.' };
  }
  const runId = row.id as string;

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
