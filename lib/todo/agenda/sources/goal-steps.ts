import 'server-only';

import { revalidatePath } from 'next/cache';
import { createGoalsClient } from '@/lib/goals/auth/server';
import { countTowards } from '@/lib/goals/rhythms-store';
import { progressLine } from '@/lib/goals/rhythms';
import { loadTodoGoals, setStepStatus } from '@/lib/goals/steps-store';
import { todoSuggestions } from '@/lib/goals/suggestions';
import { loadGoingSuggestions, recordAttended } from '@/lib/goals/suggestions-store';
import { dismiss, undismiss } from '@/lib/todo/agenda/dismissals';
import { SNOOZE_DAYS, todayIn } from '@/lib/todo/tasks/model';
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
 *
 * **Rhythms come here too, with no button** (plan #928): each live rhythm is
 * an item for its current period until the period's count is met. Its key
 * carries the period's first day, so "Later" and "Not this one" hide only
 * this period, and ticking it counts one towards the period rather than
 * closing the step. A rhythm of three a week stays on the list, reading
 * "1 of 3 this week", until the third.
 *
 * **So do suggestions you are going to** (plan #934): a city event from the
 * weekly run that you pressed going on shows on its date, linked to the
 * event's page. Ticking it records that you went and, when it was suggested
 * for a rhythm, counts one towards that rhythm's current period. One whose
 * date has passed leaves the list rather than piling up; from the day after,
 * the Goals home asks whether you went instead (plan #1020).
 */

const PREFIX = 'goal_steps:';
const RHYTHM_PREFIX = 'goal_rhythms:';
const SUGGESTION_PREFIX = 'goal_suggestions:';

export const goalStepsSource: AgendaSource = {
  id: 'goal_steps',
  label: 'Goal steps',
  module: 'goals',
  alwaysOn: true,
  description:
    'Steps from your goals that you chose to show on Todo, and your rhythms until each is met.',

  async fetch(ctx: SourceContext): Promise<AgendaItem[]> {
    const today = todayIn(ctx.timezone, ctx.now);
    const client = await createGoalsClient();
    const [{ steps, rhythms }, going] = await Promise.all([
      loadTodoGoals(client, { userId: ctx.userId, today }),
      loadGoingSuggestions(client),
    ]);

    const suggestionItems: AgendaItem[] = todoSuggestions(going, today, ctx.to).map((s) => ({
      key: `${SUGGESTION_PREFIX}${s.id}`,
      source: 'goal_steps',
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

    const rhythmItems: AgendaItem[] = rhythms.map((rhythm) => ({
      key: `${RHYTHM_PREFIX}${rhythm.id}:${rhythm.startsOn}`,
      source: 'goal_steps',
      title: rhythm.title,
      // Today, every day of the period until it is met: it is something to
      // do now, and a rhythm is never late, only kept or missed.
      day: today,
      at: null,
      link: { href: `/goals/${rhythm.goalId}`, label: rhythm.goalTitle },
      action: null,
      detail: progressLine(rhythm.period, rhythm),
      completable: true,
    }));

    return [
      ...rhythmItems,
      ...suggestionItems,
      ...steps
        // An undated step is always in the window: it goes in "Someday", as an
        // undated task does. A dated one waits until the horizon reaches it,
        // and so does one that cannot start yet, which shows on the day it
        // starts when it has no due date.
        .filter((step) => step.startsOn === null || step.startsOn <= ctx.to)
        .filter((step) => step.dueOn === null || step.dueOn <= ctx.to)
        .map(
          (step): AgendaItem => ({
            key: `${PREFIX}${step.id}`,
            source: 'goal_steps',
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
    const rhythm = rhythmOf(key);
    if (rhythm) await countTowards(client, rhythm.itemId, rhythm.startsOn, 1);
    else if (key.startsWith(SUGGESTION_PREFIX)) {
      await recordAttended(client, key.slice(SUGGESTION_PREFIX.length), true, todayIn(ctx.timezone, ctx.now));
    } else await setStepStatus(client, idOf(key), 'done');
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

/** The rhythm and period a rhythm item's key names, or null for a step's key. */
export function rhythmOf(key: string): { itemId: string; startsOn: string } | null {
  if (!key.startsWith(RHYTHM_PREFIX)) return null;
  const [itemId, startsOn] = key.slice(RHYTHM_PREFIX.length).split(':');
  if (!itemId || !startsOn) return null;
  return { itemId, startsOn };
}

/**
 * Pressing Show on Todo again is asking to see the step, so any "Later" or
 * "Not this one" left from before is lifted.
 */
export async function undismissGoalStep(userId: string, stepId: string): Promise<void> {
  await undismiss(userId, 'goal_step', `${PREFIX}${stepId}`);
}
