'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { requireUser } from '@/lib/auth/server';
import { createGoalsClient } from '@/lib/goals/auth/server';
import { undoRunChange } from '@/lib/goals/run-changes-store';
import { ACKNOWLEDGED_STALE_ERROR } from '@/lib/core/run-activities';
import type { AcknowledgeRunState } from '@/components/runs/acknowledge-run';

/**
 * Undo on one line of a run's changes (plan #1013). The rules are in
 * lib/goals/run-changes.ts: the line is read again before anything is
 * written, and each write carries the change it undoes so the history
 * records the undo against it.
 */

export type UndoChangeState = { error?: string; message?: string };

const Input = z.object({
  runId: z.string().uuid(),
  key: z.string().regex(/^\d{1,18}(:[a-z][a-z0-9_]{0,39})?$/),
});

// latency: pending
export async function undoRunChangeAction(
  _prev: UndoChangeState,
  form: FormData,
): Promise<UndoChangeState> {
  await requireUser();
  const parsed = Input.safeParse({ runId: form.get('runId'), key: form.get('key') });
  if (!parsed.success) return { error: 'Could not tell which change that was.' };
  try {
    const client = await createGoalsClient();
    const outcome = await undoRunChange(
      client,
      (target) =>
        createGoalsClient({
          undoes: target.historyId,
          undoesField: target.kind === 'field' ? target.key : undefined,
        }),
      parsed.data.runId,
      parsed.data.key,
    );
    if (!outcome.ok) return { error: outcome.error };
    revalidatePath('/goals', 'layout');
    if (outcome.undone === 0)
      return { error: 'Nothing was left to undo. Reload to see where it stands.' };
    return {
      message:
        outcome.kept > 0 ? `Undone, except ${outcome.kept} you had changed since.` : 'Undone.',
    };
  } catch {
    return { error: 'That could not be undone. Try again.' };
  }
}

/**
 * Acknowledge on a run that has gone quiet (plan #1826): it ends as failed,
 * saying it stopped writing and you saw it. Only a run still reading stale
 * is touched, so a run that woke up in the meantime keeps going.
 */
// latency: pending
export async function acknowledgeGoalRunAction(
  _prev: AcknowledgeRunState,
  form: FormData,
): Promise<AcknowledgeRunState> {
  await requireUser();
  const runId = z.string().uuid().safeParse(form.get('runId'));
  if (!runId.success) return { error: 'Could not tell which run that was.' };
  const client = await createGoalsClient();
  const { data, error } = await client
    .from('runs')
    .update({ status: 'failed', error: ACKNOWLEDGED_STALE_ERROR, ended_at: new Date().toISOString() })
    .eq('id', runId.data)
    .eq('status', 'stale')
    .select('id');
  if (error) return { error: 'That could not be saved. Try again.' };
  if (!data || data.length === 0) return { error: 'This run is not quiet any more. Reload to see where it stands.' };
  revalidatePath('/goals', 'layout');
  return {};
}
