'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { requireUser } from '@/lib/auth/server';
import { loadAccountSettings } from '@/lib/core/account/settings';
import { createGoalsClient } from '@/lib/goals/auth/server';
import { planWeek, setGoalFocus } from '@/lib/goals/focus-store';
import { todayIn } from '@/lib/todo/tasks/model';
import type { GoalsActionState } from './actions';

/**
 * The week's focus (docs/GOALS-SPEC.md, "The week's focus"): one goal's focus
 * from All goals, and the whole week's plan from the Plan your week card.
 * Both are the person's own writes; the database refuses either from Dash.
 * Each returns a sentence to show rather than throwing, as in ./actions.ts.
 */

const Id = z.string().uuid();
const Ids = z.array(Id).max(200);

function saved(): GoalsActionState {
  // The layout, so the home, All goals and Todo's goal steps all redraw.
  revalidatePath('/goals', 'layout');
  revalidatePath('/todo', 'layout');
  return { done: Date.now() };
}

/** Turn a goal's focus on or off: fields `id`, and `focus` as "true" or "false". */
// latency: optimistic
export async function setGoalFocusAction(form: FormData): Promise<GoalsActionState> {
  await requireUser();
  const id = Id.safeParse(form.get('id'));
  if (!id.success) return { error: 'Could not tell which goal that was.' };
  const focus = form.get('focus') === 'true';
  try {
    const changed = await setGoalFocus(await createGoalsClient(), id.data, focus);
    if (!changed) {
      return {
        error: focus
          ? 'Only an open goal can be a focus goal. Reload to see it.'
          : 'That goal has already changed. Reload to see it.',
      };
    }
  } catch {
    return { error: 'The focus could not be saved. Try again.' };
  }
  return saved();
}

/**
 * Save this week's plan: focus on exactly these goals, and the week recorded
 * as planned so the home stops asking until next Monday. No ids is a week
 * without a focus.
 */
// latency: pending
export async function planWeekAction(goalIds: string[]): Promise<GoalsActionState> {
  const user = await requireUser();
  const ids = Ids.safeParse(goalIds);
  if (!ids.success) return { error: 'Could not tell which goals those were.' };
  try {
    const account = await loadAccountSettings(user.id);
    await planWeek(await createGoalsClient(), {
      userId: user.id,
      goalIds: ids.data,
      today: todayIn(account.timezone),
    });
  } catch {
    return { error: "This week's focus could not be saved. Try again." };
  }
  return saved();
}
