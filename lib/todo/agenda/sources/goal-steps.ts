import 'server-only';

import { revalidatePath } from 'next/cache';
import { createGoalsClient } from '@/lib/goals/auth/server';
import { sessionClients } from '@/lib/todo/agenda/clients';
import { countTowards } from '@/lib/goals/rhythms-store';
import { progressLine } from '@/lib/goals/rhythms';
import { answerQuestion } from '@/lib/goals/shaping-store';
import { loadTodoGoals, setStepStatus } from '@/lib/goals/steps-store';
import { todoSuggestions } from '@/lib/goals/suggestions';
import { loadGoingSuggestions, recordAttended } from '@/lib/goals/suggestions-store';
import { dismiss, undismiss } from '@/lib/todo/agenda/dismissals';
import { SNOOZE_DAYS, todayIn } from '@/lib/todo/tasks/model';
import { optionAnswer, planOptions, recommendedLetter } from '@/lib/plan/options';
import type { AgendaItem, AgendaSource, SourceContext } from '@/lib/todo/agenda/sources';

/**
 * Each open goal's next step of yours, and the goal steps you pressed Show on
 * Todo on, from goals.items (docs/GOALS-SPEC.md, "Todo"; plans #927, #1266).
 *
 * The next step needs no press (plan #1266): it is the first next step the
 * Goals home shows for the goal, one per goal, and it shows today when it has
 * no date. "Not this one" hides that step only, since the dismissal is keyed
 * by the step; the goal is back on Todo once its next step is a different one.
 *
 * Read where they live and never copied into todo.tasks. **Ticking one closes
 * the step in Goals**, because it is the same row, and the goals history
 * records it as yours. "Later" and "Not this one" write only a dismissal: the
 * step has nothing that means "not on my list this week" without changing
 * the step itself, which is the return deadline's position too.
 *
 * Always on. A flagged step was asked for one at a time with the button on
 * the step, and a goal's next step is what Todo is for, so a switch on the
 * Todo settings page could only hide what you need to see. Turning the Goals
 * workspace off still takes them away, as it does for every source.
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
const QUESTION_PREFIX = 'goal_questions:';

/** The longest answer the goal page accepts, which an option's never nears. */
const ANSWER_MAX = 20000;

export const goalStepsSource: AgendaSource = {
  id: 'goal_steps',
  label: 'Goal steps',
  module: 'goals',
  alwaysOn: true,
  description:
    "Each goal's next step, steps you chose to show on Todo, and your rhythms until each is met.",

  async fetch(ctx: SourceContext): Promise<AgendaItem[]> {
    const today = todayIn(ctx.timezone, ctx.now);
    const client = await (ctx.clients ?? sessionClients).goals();
    const [{ steps, questions, rhythms }, going] = await Promise.all([
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

    const rhythmItems: AgendaItem[] = rhythms.map((rhythm) => ({
      key: `${RHYTHM_PREFIX}${rhythm.id}:${rhythm.startsOn}`,
      source: 'goal_steps',
      ref: `goals.items:${rhythm.id}`,
      title: rhythm.title,
      // Today, every day of the period until it is met: it is something to
      // do now, and a rhythm is never late, only kept or missed.
      day: today,
      at: null,
      link: { href: `/goals/${rhythm.goalId}`, label: rhythm.goalTitle },
      action: null,
      detail: progressLine(rhythm.period, rhythm, rhythm.source?.kind),
      // A rhythm that counts itself from Jobs or the calendar is kept by
      // doing the thing, not by ticking it here.
      completable: !rhythm.source,
    }));

    const questionItems: AgendaItem[] = questions.map((question) => {
      const options = planOptions(question.detail);
      const recommended = recommendedLetter(question.detail, options);
      return {
        key: `${QUESTION_PREFIX}${question.id}`,
        source: 'goal_steps',
        ref: `goals.items:${question.id}`,
        title: question.title,
        // Today: a question holds up whatever sits above it on the goal.
        day: today,
        at: null,
        link: { href: `/goals/${question.goalId}#step-${question.id}`, label: question.goalTitle },
        action: null,
        detail: options.length > 0 ? 'Waiting on your answer' : 'Answer it on the goal',
        completable: false,
        ...(options.length > 0 && {
          options: options.map((option) => ({
            letter: option.letter,
            label: option.label,
            answer: optionAnswer(option),
            recommended: option.letter === recommended,
          })),
        }),
      };
    });

    return [
      ...questionItems,
      ...rhythmItems,
      ...suggestionItems,
      ...steps
        // An undated step is always in the window: a goal's next step shows
        // today, and one only flagged goes in "On you, no date", as an undated task
        // does. A dated one waits until the horizon reaches it, and so does
        // one that cannot start yet, which shows on the day it starts when it
        // has no due date.
        .filter((step) => step.startsOn === null || step.startsOn <= ctx.to)
        .filter((step) => step.dueOn === null || step.dueOn <= ctx.to)
        .map(
          (step): AgendaItem => ({
            key: `${PREFIX}${step.id}`,
            source: 'goal_steps',
            ref: `goals.items:${step.id}`,
            title: step.title,
            day: step.dueOn ?? step.startsOn ?? (step.next ? today : null),
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
    if (key.startsWith(QUESTION_PREFIX)) throw new Error('A question is answered, not ticked.');
    const client = await createGoalsClient();
    const rhythm = rhythmOf(key);
    if (rhythm) await countTowards(client, rhythm.itemId, rhythm.startsOn, 1);
    else if (key.startsWith(SUGGESTION_PREFIX)) {
      await recordAttended(client, key.slice(SUGGESTION_PREFIX.length), true, todayIn(ctx.timezone, ctx.now));
    } else await setStepStatus(client, idOf(key), 'done');
    revalidatePath('/goals', 'layout');
  },

  async answer(_ctx, key, answer) {
    if (!key.startsWith(QUESTION_PREFIX)) return { error: 'Only a question can be answered.' };
    const text = answer.trim();
    if (!text) return { error: 'Choose an answer first.' };
    if (text.length > ANSWER_MAX) return { error: 'That answer is too long.' };
    try {
      const answered = await answerQuestion(
        await createGoalsClient(),
        key.slice(QUESTION_PREFIX.length),
        text,
      );
      if (!answered) return { error: 'That question was withdrawn or is gone.' };
    } catch {
      return { error: 'The answer could not be saved. Try again.' };
    }
    revalidatePath('/goals', 'layout');
    return { error: null };
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
