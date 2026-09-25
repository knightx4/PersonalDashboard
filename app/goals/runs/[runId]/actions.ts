'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { requireUser } from '@/lib/auth/server';
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
