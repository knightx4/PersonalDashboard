'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { requireUser } from '@/lib/auth/server';
import { fireFeatureRoutine, goalsRoutine } from '@/lib/feedback/routine';
import { createYouClient } from '@/lib/you/auth/server';
import { saveVerdict, VERDICTS, type InsightVerdict, type Verdict } from '@/lib/you/insights';
import { INSIGHT_RUN_STALE_AFTER_MS, insightRunBrief, STALE_RUN_ERROR } from '@/lib/you/insights-run';

/** What a mark sends back: the verdict as saved, or why it was not. */
export type MarkResult = { error: string | null; saved?: InsightVerdict };

/**
 * Mark one insight right, not quite or wrong, with an optional line of why
 * (plan #2413.5). Marking it again replaces the mark.
 */
// latency: pending
export async function markInsight(insightId: string, verdict: Verdict, note?: string | null): Promise<MarkResult> {
  if (!z.string().uuid().safeParse(insightId).success) return { error: 'That is not an insight.' };
  if (!VERDICTS.includes(verdict)) return { error: 'That is not a mark.' };
  const user = await requireUser();
  try {
    const saved = await saveVerdict(await createYouClient(), user.id, insightId, verdict, note);
    revalidatePath('/you/insights');
    return { error: null, saved };
  } catch (error) {
    return { error: error instanceof Error ? error.message : 'Your mark was not saved. Try again.' };
  }
}

/**
 * Look again: start an insights run from the tab, the way the Research
 * button starts one on a company (startCompanyResearch in
 * app/jobs/(app)/companies/actions.ts). The run row is made first, queued,
 * so the tab shows it at once; the goals routine is then fired with a brief
 * naming it. A run left queued or running past the stale mark is marked
 * failed before the check, so a session that died does not hold the button.
 * A fire that fails marks the new row failed with the answer, which is what
 * the tab then shows.
 */
// latency: pending
export async function startInsightRun(): Promise<{ error: string | null }> {
  const routine = goalsRoutine();
  if (!routine.id || !routine.token) {
    return {
      error:
        'Insights run on the goals routine, which is not set up on this deployment: it needs CLAUDE_GOALS_ROUTINE_ID and CLAUDE_GOALS_ROUTINE_TOKEN.',
    };
  }

  const user = await requireUser();
  const you = await createYouClient();

  await you
    .from('insight_runs')
    .update({ status: 'failed', error: STALE_RUN_ERROR, finished_at: new Date().toISOString() })
    .eq('user_id', user.id)
    .in('status', ['queued', 'running'])
    .lt('requested_at', new Date(Date.now() - INSIGHT_RUN_STALE_AFTER_MS).toISOString());

  const { data: row, error } = await you
    .from('insight_runs')
    .insert({ user_id: user.id, status: 'queued' })
    .select('id')
    .single();
  // The partial unique index allows one run at a time.
  if (error?.code === '23505') return { error: 'Dash is already looking again.' };
  if (error || !row) return { error: error?.message ?? 'Could not start the run.' };
  const runId = row.id as string;

  const fired = await fireFeatureRoutine({
    apiKey: routine.token,
    routineId: routine.id,
    text: insightRunBrief({ runId, userId: user.id }),
  });

  if (!fired.ok) {
    await you
      .from('insight_runs')
      .update({ status: 'failed', error: `Dash could not start the run. ${fired.error}`.slice(0, 2000) })
      .eq('id', runId)
      .eq('user_id', user.id);
    revalidatePath('/you/insights');
    return { error: fired.error };
  }

  const body = fired.body as Record<string, unknown> | null;
  const runUrl = typeof body?.claude_code_session_url === 'string' ? body.claude_code_session_url : null;
  if (runUrl) {
    await you.from('insight_runs').update({ run_url: runUrl.slice(0, 500) }).eq('id', runId).eq('user_id', user.id);
  }

  revalidatePath('/you/insights');
  return { error: null };
}
