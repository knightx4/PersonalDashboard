'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { requireUser } from '@/lib/auth/server';
import { loadAccountSettings } from '@/lib/core/account/settings';
import { createGoalsClient } from '@/lib/goals/auth/server';
import { parseYourReaction } from '@/lib/goals/suggestions';
import { reactToSuggestion, recordAttended } from '@/lib/goals/suggestions-store';
import { undismiss } from '@/lib/todo/agenda/dismissals';
import { todayIn } from '@/lib/todo/tasks/model';

/**
 * Going and not for me on a suggestion from the weekly run (plan #934). The
 * reaction is written on the suggestion's own row, where the next week's
 * research reads it. Going is also what puts it on Todo: the Goals agenda
 * source reads the rows marked going, so nothing is copied into todo.tasks.
 */

export type SuggestionActionState = { error?: string; done?: number };

const Id = z.string().uuid();

// latency: pending
export async function reactToSuggestionAction(
  _prev: SuggestionActionState,
  form: FormData,
): Promise<SuggestionActionState> {
  const user = await requireUser();
  const id = Id.safeParse(form.get('id'));
  if (!id.success) return { error: 'Could not tell which suggestion that was.' };
  const reaction = parseYourReaction(form.get('reaction'));
  if (!reaction) return { error: 'Choose going or not for me.' };
  try {
    const changed = await reactToSuggestion(await createGoalsClient(), id.data, reaction);
    if (!changed) return { error: 'That suggestion is gone. Reload to see the list.' };
    // Pressing going again is asking to see it, so a "Later" or "Not this
    // one" left on Todo from before is lifted.
    if (reaction === 'going') await undismiss(user.id, 'goal_step', `goal_suggestions:${id.data}`);
  } catch {
    return { error: 'Your answer could not be saved. Try again.' };
  }
  revalidatePath('/goals', 'layout');
  revalidatePath('/todo', 'layout');
  revalidatePath('/home');
  return { done: Date.now() };
}

/**
 * Yes or no to "Did you go?", asked on the home the day after an event you
 * said you were going to (plan #1020). Written to the suggestion's attended,
 * which the next weekly brief reads beside the reaction.
 */
// latency: pending
export async function recordAttendedAction(
  _prev: SuggestionActionState,
  form: FormData,
): Promise<SuggestionActionState> {
  const user = await requireUser();
  const id = Id.safeParse(form.get('id'));
  if (!id.success) return { error: 'Could not tell which suggestion that was.' };
  const went = form.get('went');
  if (went !== 'yes' && went !== 'no') return { error: 'Choose yes or no.' };
  try {
    const account = await loadAccountSettings(user.id);
    const changed = await recordAttended(
      await createGoalsClient(),
      id.data,
      went === 'yes',
      todayIn(account.timezone),
    );
    if (!changed) return { error: 'That was already answered. Reload to see the list.' };
  } catch {
    return { error: 'Your answer could not be saved. Try again.' };
  }
  revalidatePath('/goals', 'layout');
  revalidatePath('/todo', 'layout');
  revalidatePath('/home');
  return { done: Date.now() };
}
