import 'server-only';

import { revalidatePath } from 'next/cache';
import { createGoalsClient } from '@/lib/goals/auth/server';
import { sessionClients } from '@/lib/todo/agenda/clients';
import { loadTodoGoals, setStepStatus } from '@/lib/goals/steps-store';
import { todoSuggestions } from '@/lib/goals/suggestions';
import { loadGoingSuggestions, recordAttended } from '@/lib/goals/suggestions-store';
import { dismiss, undismiss } from '@/lib/todo/agenda/dismissals';
import { SNOOZE_DAYS, todayIn } from '@/lib/todo/tasks/model';
import type { AgendaItem, AgendaSource, SourceContext } from '@/lib/todo/agenda/sources';

/**
 * The goal steps sent to Todo, from goals.items (docs/GOALS-SPEC.md, "Todo";
 * plans #927, #1735): a step of yours you pressed Send to Todo on, or one
 * Dash put there. Nothing else from a goal comes through on its own. Each
 * goal's next step, its rhythms, Dash's open questions and Dash's results
 * to read used to, and since plan #1735 they stay on the Goals home: most
 * goals have no deadline, and Todo is for what you chose to do.
 *
 * Read where they live and never copied into todo.tasks. **Ticking one closes
 * the step in Goals**, because it is the same row, and the goals history
 * records it as yours. "Later" and "Not this one" write only a dismissal: the
 * step has nothing that means "not on my list this week" without changing
 * the step itself, which is the return deadline's position too. Take off
 * Todo on the step clears the flag.
 *
 * Always on. A sent step was asked for one at a time, so a switch on the
 * Todo settings page could only hide what you need to see. Turning the Goals
 * workspace off still takes them away, as it does for every source.
 *
 * **So do suggestions you are going to** (plan #934): a city event from the
 * weekly run that you pressed going on shows on its date, linked to the
 * event's page. Ticking it records that you went and, when it was suggested
 * for a rhythm, counts one towards that rhythm's current period. One whose
 * date has passed leaves the list rather than piling up; from the day after,
 * the Goals home asks whether you went instead (plan #1020).
 */

const PREFIX = 'goal_steps:';
const SUGGESTION_PREFIX = 'goal_suggestions:';

export const goalStepsSource: AgendaSource = {
  id: 'goal_steps',
  label: 'Goal steps',
  module: 'goals',
  alwaysOn: true,
  description:
    'Goal steps you or Dash sent to Todo, and events you said you would go to.',

  async fetch(ctx: SourceContext): Promise<AgendaItem[]> {
    const today = todayIn(ctx.timezone, ctx.now);
    const client = await (ctx.clients ?? sessionClients).goals();
    const [{ steps }, going] = await Promise.all([
      loadTodoGoals(client, { userId: ctx.userId, today }),
      loadGoingSuggestions(client, ctx.userId),
    ]);

    const suggestionItems: AgendaItem[] = todoSuggestions(going, today, ctx.to).map((s) => ({
      key: `${SUGGESTION_PREFIX}${s.id}`,
      source: 'goal_steps',
      ref: `goals.suggestions:${s.id}`,
      title: s.title,
      day: s.happensOn,
      at: s.startsAt,
      link: s.url
        ? { href: s.url, label: s.source ?? 'Event page' }
        : { href: '/goals', label: 'Goals' },
      action: null,
      detail: s.place,
      completable: true,
    }));

    return [
      ...suggestionItems,
      ...steps
        // An undated step is always in the window and goes in "On you, no
        // date", as an undated task does. A dated one waits until the horizon
        // reaches it, and so does one that cannot start yet, which shows on
        // the day it starts when it has no due date.
        .filter((step) => step.startsOn === null || step.startsOn <= ctx.to)
        .filter((step) => step.dueOn === null || step.dueOn <= ctx.to)
        .map(
          (step): AgendaItem => ({
            key: `${PREFIX}${step.id}`,
            source: 'goal_steps',
            ref: `goals.items:${step.id}`,
            title: step.title,
            day: step.dueOn ?? step.startsOn,
            at: null,
            link: { href: `/goals/${step.goalId}`, label: step.goalTitle },
            action: null,
            detail: null,
            completable: true,
          }),
        ),
    ];
  },

  async complete(ctx, key) {
    const client = await createGoalsClient();
    if (key.startsWith(SUGGESTION_PREFIX)) {
      await recordAttended(client, key.slice(SUGGESTION_PREFIX.length), true, todayIn(ctx.timezone, ctx.now));
    } else if (key.startsWith(PREFIX)) await setStepStatus(client, idOf(key), 'done');
    // A rhythm or question item left on a page opened before plan #1735 is
    // no longer Todo's to tick; it is kept on the Goals home.
    else throw new Error('That item is no longer on Todo.');
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
 * Pressing Send to Todo again is asking to see the step, so any "Later" or
 * "Not this one" left from before is lifted.
 */
export async function undismissGoalStep(userId: string, stepId: string): Promise<void> {
  await undismiss(userId, 'goal_step', `${PREFIX}${stepId}`);
}
