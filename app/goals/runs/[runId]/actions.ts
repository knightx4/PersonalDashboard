'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createClient, requireUser } from '@/lib/auth/server';
import { acknowledgeStaleRun } from '@/lib/core/run-ack';
import { createGoalsClient } from '@/lib/goals/auth/server';
import { undoRunChange } from '@/lib/goals/run-changes-store';

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
 * Acknowledge a goal run that went silent, which ends it (plan #1825). A run
 * that stops writing lines is marked stale rather than closed, and waits for
 * this.
 */
// latency: pending
export async function acknowledgeGoalRunAction(runId: string): Promise<{ error?: string }> {
  await requireUser();
  if (!z.string().uuid().safeParse(runId).success) return { error: 'Could not tell which run that was.' };
  const { ended, error } = await acknowledgeStaleRun(await createClient(), 'goals.runs', runId);
  if (error) return { error: 'The run could not be ended. Try again.' };
  revalidatePath('/goals', 'layout');
  if (!ended) return { error: 'That run is no longer silent. Reload to see where it stands.' };
  return {};
}
