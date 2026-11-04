'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { requireUser } from '@/lib/auth/server';
import { loadAccountSettings } from '@/lib/core/account/settings';
import { createGoalsClient } from '@/lib/goals/auth/server';
import { undoProgressEntry, updateProgressEntry } from '@/lib/goals/progress-store';
import { todayIn } from '@/lib/todo/tasks/model';

/**
 * Changing a logged progress entry from the Hours page (plan #2907.1). It
 * returns a sentence to show rather than throwing, so a refused change leaves
 * the page standing with the reason beside the entry.
 */

export type ProgressEntryState = { error?: string; ok?: true };

const Change = z.object({
  id: z.string().uuid(),
  text: z.string().max(2000).optional(),
  quantity: z.number().nullable().optional(),
  unit: z.string().max(200).nullable().optional(),
  happenedOn: z.string().max(10).optional(),
});

export type ProgressEntryChange = z.input<typeof Change>;

function refresh() {
  revalidatePath('/goals/hours');
  revalidatePath('/goals', 'layout');
}

/** Change an entry's text, amount, unit or day. */
// latency: pending
export async function changeProgressEntry(input: ProgressEntryChange): Promise<ProgressEntryState> {
  const user = await requireUser();
  const parsed = Change.safeParse(input);
  if (!parsed.success) return { error: 'Could not tell which entry that was.' };
  const { id, ...change } = parsed.data;
  try {
    const account = await loadAccountSettings(user.id);
    const client = await createGoalsClient();
    const result = await updateProgressEntry(client, id, change, todayIn(account.timezone));
    if (result.status === 'refused') return { error: result.error };
    if (result.status === 'gone') return { error: 'That entry is gone or was already undone.' };
    refresh();
    return { ok: true };
  } catch {
    return { error: 'That could not be changed. Try again.' };
  }
}

/** Take an entry back. */
// latency: pending
export async function undoLoggedProgress(id: string): Promise<ProgressEntryState> {
  await requireUser();
  const parsed = z.string().uuid().safeParse(id);
  if (!parsed.success) return { error: 'Could not tell which entry that was.' };
  try {
    const client = await createGoalsClient();
    if (!(await undoProgressEntry(client, parsed.data))) {
      return { error: 'That entry is gone or was already undone.' };
    }
    refresh();
    return { ok: true };
  } catch {
    return { error: 'That could not be undone. Try again.' };
  }
}
