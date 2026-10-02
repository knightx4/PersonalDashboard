'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { requireUser } from '@/lib/auth/server';
import { createGoalsClient } from '@/lib/goals/auth/server';
import { formatDay } from '@/lib/goals/dates';
import { saveErrandAndStart } from '@/lib/goals/errand-store';
import {
  SET_ASIDE_CHOICES,
  setAsideFields,
  setAsideOn,
} from '@/lib/goals/set-aside';
import { updateStep } from '@/lib/goals/steps-store';
import { COMMENT_MAX } from '@/lib/goals/comments';
import { GOAL_TITLE_MAX } from '@/lib/goals/tree';
import { loadAccountSettings } from '@/lib/core/account/settings';
import { todayIn } from '@/lib/todo/tasks/model';
import { addGoalComment } from './[goalId]/comment-actions';

/**
 * The Goals home's own writes: Not now on a row of Up next, its undo, and Ask
 * Dash. Preparing a step and working a goal from Put Dash to work go through
 * the goal page's own actions (shaping-actions.ts), so they refuse the same
 * things there and here.
 */

export type SetAsideState = {
  error?: string;
  message?: string;
  /** What the step held before, for the toast's Undo. */
  before?: { id: string; startsOn: string | null; dueOn: string | null };
};

const Id = z.string().uuid();
const Choice = z.enum(SET_ASIDE_CHOICES as [string, ...string[]]);
const Day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

function redraw() {
  revalidatePath('/goals', 'layout');
}

/**
 * Put a step aside until the day a choice means (lib/goals/set-aside.ts): its
 * start date set to that day, and its due date moved with it when it was due
 * sooner. The row leaves Up next at once on the page, and the step comes back
 * on that day.
 */
// latency: optimistic
export async function setAsideAction(form: FormData): Promise<SetAsideState> {
  const user = await requireUser();
  const id = Id.safeParse(form.get('id'));
  const choice = Choice.safeParse(form.get('choice'));
  if (!id.success || !choice.success) return { error: 'Could not tell what to set aside.' };

  const client = await createGoalsClient();
  const { data: step, error } = await client
    .from('items')
    .select('id, starts_on, due_on')
    .eq('id', id.data)
    .eq('level', 'step')
    .is('archived_at', null)
    .maybeSingle();
  if (error || !step) return { error: 'That step is no longer on the page.' };

  const account = await loadAccountSettings(user.id);
  const on = setAsideOn(choice.data as Parameters<typeof setAsideOn>[0], todayIn(account.timezone));
  const { dueMoved, ...fields } = setAsideFields({ dueOn: step.due_on as string | null }, on);
  try {
    if (!(await updateStep(client, id.data, fields))) {
      return { error: 'That step is no longer on the page.' };
    }
  } catch {
    return { error: 'It could not be set aside. Try again.' };
  }
  redraw();
  return {
    message: dueMoved
      ? `Set aside until ${formatDay(on)}. Its due date moved with it.`
      : `Set aside until ${formatDay(on)}.`,
    before: {
      id: id.data,
      startsOn: (step.starts_on as string | null) ?? null,
      dueOn: (step.due_on as string | null) ?? null,
    },
  };
}

/** Undo a Not now: the start and due dates the step held before. */
// latency: optimistic
export async function restoreAsideAction(form: FormData): Promise<SetAsideState> {
  await requireUser();
  const id = Id.safeParse(form.get('id'));
  if (!id.success) return { error: 'Could not tell which step that was.' };
  const startsOn = form.get('startsOn');
  const dueOn = form.get('dueOn');
  const day = (value: FormDataEntryValue | null) =>
    typeof value === 'string' && Day.safeParse(value).success ? value : null;
  try {
    await updateStep(await createGoalsClient(), id.data, {
      starts_on: day(startsOn),
      due_on: day(dueOn),
    });
  } catch {
    return { error: 'It could not be put back. Its date is on its goal page.' };
  }
  redraw();
  return { message: 'Put back.' };
}

/** Bring a set-aside step back now: its start date cleared, its due date left as it is. */
// latency: optimistic
export async function bringBackAction(form: FormData): Promise<SetAsideState> {
  await requireUser();
  const id = Id.safeParse(form.get('id'));
  if (!id.success) return { error: 'Could not tell which step that was.' };
  try {
    if (!(await updateStep(await createGoalsClient(), id.data, { starts_on: null }))) {
      return { error: 'That step is no longer on the page.' };
    }
  } catch {
    return { error: 'It could not be brought back. Try again.' };
  }
  redraw();
  return { message: 'Back on you.' };
}

export type AskDashState = { error?: string; message?: string; goalId?: string; done?: number };

/**
 * Ask Dash from the Goals home. `target` is a goal's id or `errand`.
 *
 * On a goal, the words go in as an @dash comment on it (addGoalComment), so
 * Dash answers in the goal's thread, or starts a run when the ask needs one.
 * As an errand, they are the errand's title, saved with its due date and
 * handed to Dash in the same press (saveErrandAndStart).
 */
// latency: pending
export async function askDashAction(_prev: AskDashState, form: FormData): Promise<AskDashState> {
  const user = await requireUser();
  const body = String(form.get('body') ?? '').trim();
  const target = String(form.get('target') ?? '');
  if (!body) return { error: 'Say what Dash should do.' };

  if (target === 'errand') {
    if (body.length > GOAL_TITLE_MAX) {
      return { error: `Keep an errand under ${GOAL_TITLE_MAX} characters. Put the rest on its page.` };
    }
    const areaId = Id.safeParse(form.get('areaId'));
    const due = Day.safeParse(form.get('due'));
    if (!areaId.success) return { error: 'Choose which area the errand is for.' };
    if (!due.success) return { error: 'An errand needs a date it is due by.' };
    const result = await saveErrandAndStart({
      client: await createGoalsClient(),
      user,
      areaId: areaId.data,
      title: body,
      dueOn: due.data,
    });
    if (!result.ok) return { error: result.error };
    redraw();
    return { message: result.message, goalId: result.goalId, done: Date.now() };
  }

  const goalId = Id.safeParse(target);
  if (!goalId.success) return { error: 'Choose a goal, or make it a new errand.' };
  if (body.length > COMMENT_MAX - 7) return { error: 'That is too long for one ask.' };
  const comment = new FormData();
  comment.set('id', goalId.data);
  comment.set('body', `@dash ${body}`);
  const result = await addGoalComment({}, comment);
  if (result.error) return { error: result.error };
  redraw();
  return { message: result.message, goalId: goalId.data, done: Date.now() };
}
