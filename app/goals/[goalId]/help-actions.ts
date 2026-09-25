'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { requireUser } from '@/lib/auth/server';
import { createGoalsClient } from '@/lib/goals/auth/server';
import { parseHelpKindFields } from '@/lib/goals/help-kinds';
import { setGoalHelpKinds, turnDownHelpProposal } from '@/lib/goals/help-kinds-store';

/**
 * Save the kinds of weekly help a goal asks for (plan #1027): the ticked
 * kinds and a note on each. Returns a sentence to show rather than throwing.
 */

export type HelpKindsActionState = { error?: string; done?: number };

const Id = z.string().uuid();

// latency: pending
export async function setHelpKindsAction(
  _prev: HelpKindsActionState,
  form: FormData,
): Promise<HelpKindsActionState> {
  await requireUser();
  const goalId = Id.safeParse(form.get('goalId'));
  if (!goalId.success) return { error: 'Could not tell which goal that was.' };
  const parsed = parseHelpKindFields(
    (key) => form.getAll(key),
    (key) => form.get(key),
  );
  if (!parsed.ok) return { error: parsed.error };
  try {
    const changed = await setGoalHelpKinds(await createGoalsClient(), goalId.data, parsed.value);
    if (!changed) return { error: 'That goal is no longer on the page.' };
  } catch {
    return { error: 'The kinds of help could not be saved. Try again.' };
  }
  revalidatePath('/goals', 'layout');
  return { done: Date.now() };
}

/** Turn down the kinds of help Claude proposed for a goal (plan #1029). */
// latency: pending
export async function turnDownHelpAction(
  _prev: HelpKindsActionState,
  form: FormData,
): Promise<HelpKindsActionState> {
  await requireUser();
  const goalId = Id.safeParse(form.get('goalId'));
  if (!goalId.success) return { error: 'Could not tell which goal that was.' };
  try {
    const changed = await turnDownHelpProposal(await createGoalsClient(), goalId.data);
    if (!changed) return { error: 'That proposal is no longer waiting.' };
  } catch {
    return { error: 'The proposal could not be turned down. Try again.' };
  }
  revalidatePath('/goals', 'layout');
  return { done: Date.now() };
}
