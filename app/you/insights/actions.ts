'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { requireUser } from '@/lib/auth/server';
import { goalsRoutine } from '@/lib/feedback/routine';
import { createYouClient } from '@/lib/you/auth/server';
import { saveVerdict, VERDICTS, type InsightVerdict, type Verdict } from '@/lib/you/insights';
import { kickInsightRunAfterResponse } from '@/lib/you/insights-kick';
import { queueInsightRun, startInsightRun as startRun } from '@/lib/you/insights-start';

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
 * Look again: queue a run, which the tab shows running at once, and start the
 * single model call in a function of its own after the response (plan
 * #2413.10). The call takes minutes, so nothing here waits for it
 * (lib/you/insights-kick.ts, inngest/you/insights-write.ts).
 */
// latency: pending
export async function startInsightRun(): Promise<{ error: string | null }> {
  const user = await requireUser();
  const client = await createYouClient();
  const queued = await queueInsightRun({ client, userId: user.id });
  if (!queued.queued) return { error: queued.error };
  kickInsightRunAfterResponse(queued.runId, async () => {
    await client
      .from('insight_runs')
      .update({
        status: 'failed',
        error: 'Dash could not start the run. Try again.',
        finished_at: new Date().toISOString(),
      })
      .eq('id', queued.runId)
      .eq('user_id', user.id);
  });
  revalidatePath('/you/insights');
  return { error: null };
}

/**
 * Full re-read: the slow way, a whole session on the goals routine with the
 * insights skill, which reads every note and sends readers across the
 * person's history. It spends their Claude plan, so it only starts here,
 * when they choose it.
 */
// latency: pending
export async function startFullReread(): Promise<{ error: string | null }> {
  const user = await requireUser();
  const result = await startRun({
    client: await createYouClient(),
    userId: user.id,
    reason: 'full_reread',
    routine: goalsRoutine(),
  });
  revalidatePath('/you/insights');
  return { error: result.started ? null : result.error };
}
