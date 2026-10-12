'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createClient, requireUser } from '@/lib/auth/server';
import { ACKNOWLEDGED_STALE_ERROR } from '@/lib/core/run-activities';
import { answerFrom } from '@/lib/core/run-questions';
import { answerPlanRun } from '@/lib/plan/run-answer';
import type { AcknowledgeRunState } from '@/components/runs/acknowledge-run';
import type { AnswerRunState } from '@/components/runs/run-answer';

/**
 * Acknowledge on a plan run that has gone quiet (plan #1826): it ends as
 * failed, saying it stopped writing and you saw it. Only a run still reading
 * stale is touched, so a run that woke up in the meantime keeps going. Kept
 * out of actions.ts, which every plan press already loads.
 */
// latency: pending
export async function acknowledgePlanRunAction(
  _prev: AcknowledgeRunState,
  form: FormData,
): Promise<AcknowledgeRunState> {
  const user = await requireUser();
  const runId = z.string().uuid().safeParse(form.get('runId'));
  if (!runId.success) return { error: 'Could not tell which run that was.' };
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('plan_runs')
    .update({ status: 'failed', error: ACKNOWLEDGED_STALE_ERROR })
    .eq('id', runId.data)
    .eq('user_id', user.id)
    .eq('status', 'stale')
    .select('id');
  if (error) return { error: 'That could not be saved. Try again.' };
  if (!data || data.length === 0) return { error: 'This run is not quiet any more. Reload to see where it stands.' };
  revalidatePath('/dev/plan', 'layout');
  return {};
}

/**
 * Your answer to the question a plan run is waiting on (plan #1824), from the
 * run's lines or from the inbox. The rules are in lib/plan/run-answer.ts:
 * written as a response line, then the run is woken, or continued as a new
 * run when its session has stopped.
 */
// latency: pending
export async function answerPlanRunAction(_prev: AnswerRunState, form: FormData): Promise<AnswerRunState> {
  const user = await requireUser();
  const runId = z.string().uuid().safeParse(form.get('runId'));
  if (!runId.success) return { error: 'Could not tell which run that was.' };
  const parsed = answerFrom(form.get('answer'));
  if ('refusal' in parsed) return { error: parsed.refusal };
  const supabase = await createClient();
  const outcome = await answerPlanRun({ supabase, userId: user.id, runId: runId.data, answer: parsed.answer });
  if (!outcome.ok) return { error: outcome.error };
  revalidatePath('/dev', 'layout');
  return { answered: parsed.answer, continued: outcome.continued };
}
