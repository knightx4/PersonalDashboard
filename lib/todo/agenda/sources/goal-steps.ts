import 'server-only';

import { revalidatePath } from 'next/cache';
import { createGoalsClient } from '@/lib/goals/auth/server';
import { loadTodoSteps, setStepStatus } from '@/lib/goals/steps-store';
import { dismiss, undismiss } from '@/lib/todo/agenda/dismissals';
import { SNOOZE_DAYS } from '@/lib/todo/tasks/model';
import type { AgendaItem, AgendaSource, SourceContext } from '@/lib/todo/agenda/sources';

/**
 * Goal steps you pressed Show on Todo on, from goals.items (docs/GOALS-SPEC.md,
 * "Todo"; plan #927).
 *
 * Read where they live and never copied into todo.tasks. **Ticking one closes
 * the step in Goals**, because it is the same row, and the goals history
 * records it as yours. "Later" and "Not this one" write only a dismissal: the
 * step has nothing that means "not on my list this week" without changing
 * the step itself, which is the return deadline's position too.
 *
 * Always on. Each item was asked for one at a time with the button on the
 * step, so a switch on the Todo settings page could only hide what you had
 * just asked to see. Turning the Goals workspace off still takes them away,
 * as it does for every source.
 */

const PREFIX = 'goal_steps:';

export const goalStepsSource: AgendaSource = {
  id: 'goal_steps',
  label: 'Goal steps',
  module: 'goals',
  alwaysOn: true,
  description: 'Steps from your goals that you chose to show on Todo.',

  async fetch(ctx: SourceContext): Promise<AgendaItem[]> {
    const steps = await loadTodoSteps(await createGoalsClient());

    return (
      steps
        // An undated step is always in the window: it goes in "Someday", as an
        // undated task does. A dated one waits until the horizon reaches it.
        .filter((step) => step.dueOn === null || step.dueOn <= ctx.to)
        .map((step) => ({
          key: `${PREFIX}${step.id}`,
          source: 'goal_steps',
          title: step.title,
          day: step.dueOn,
          at: null,
          link: { href: `/goals/${step.goalId}`, label: step.goalTitle },
          action: null,
          detail: null,
          completable: true,
        }))
    );
  },

  async complete(_ctx, key) {
    await setStepStatus(await createGoalsClient(), idOf(key), 'done');
    revalidatePath('/goals', 'layout');
  },

  async defer(ctx, key) {
    const until = new Date(ctx.now);
    until.setUTCDate(until.getUTCDate() + SNOOZE_DAYS);
    await dismiss(ctx.userId, 'goal_step', key, until);
  },

  async dismiss(ctx, key) {
    await dismiss(ctx.userId, 'goal_step', key, null);
  },
};

function idOf(key: string): string {
  return key.slice(PREFIX.length);
}

/**
 * Pressing Show on Todo again is asking to see the step, so any "Later" or
 * "Not this one" left from before is lifted.
 */
export async function undismissGoalStep(userId: string, stepId: string): Promise<void> {
  await undismiss(userId, 'goal_step', `${PREFIX}${stepId}`);
}
