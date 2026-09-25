'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import type { TreeActionState } from '@/components/plan-tree/types';
import { requireUser } from '@/lib/auth/server';
import { createGoalsClient } from '@/lib/goals/auth/server';
import { answerQuestion, setQuestionAside } from '@/lib/goals/shaping-store';
import { STEP_TITLE_MAX } from '@/lib/goals/steps';
import { insertStep } from '@/lib/goals/steps-store';

/**
 * The goal page's writes for the shared tree's questions (plan #982).
 *
 * Each reads the form fields the dev plan's actions read, which is what the
 * shared components in components/plan-tree post: `answer` takes `id` and
 * `answer`, `dismissQuestion` takes `id` and `dismissed`, and `ask` takes
 * `parent` and `title`. Each says what it did in `message`, which is what
 * closes the form that sent it.
 */

const Id = z.string().uuid();
const ANSWER_MAX = 20000;

function saved(message: string): TreeActionState {
  revalidatePath('/goals', 'layout');
  return { message };
}

// latency: pending
export async function answerGoalQuestion(
  _prev: TreeActionState,
  form: FormData,
): Promise<TreeActionState> {
  await requireUser();
  const id = Id.safeParse(form.get('id'));
  if (!id.success) return { error: 'Could not tell which question that was.' };
  const answer = String(form.get('answer') ?? '').trim();
  if (!answer) return { error: 'Write an answer first.' };
  if (answer.length > ANSWER_MAX) return { error: 'That answer is too long.' };
  try {
    const answered = await answerQuestion(await createGoalsClient(), id.data, answer);
    if (!answered) return { error: 'That question was withdrawn or is gone.' };
  } catch {
    return { error: 'The answer could not be saved. Try again.' };
  }
  return saved('Answered.');
}

/** Not now on a question beneath a step, or Bring back. */
// latency: pending
export async function dismissGoalQuestion(
  _prev: TreeActionState,
  form: FormData,
): Promise<TreeActionState> {
  await requireUser();
  const id = Id.safeParse(form.get('id'));
  if (!id.success) return { error: 'Could not tell which question that was.' };
  const aside = form.get('dismissed') !== '0';
  try {
    const changed = await setQuestionAside(await createGoalsClient(), id.data, aside);
    if (!changed) return { error: 'That question has been answered or is gone.' };
  } catch {
    return { error: 'Could not put the question aside. Try again.' };
  }
  return saved(aside ? 'Put aside.' : 'Brought back.');
}

/** A question for you beneath a step, asked from the step. */
// latency: pending
export async function askGoalQuestion(
  _prev: TreeActionState,
  form: FormData,
): Promise<TreeActionState> {
  const user = await requireUser();
  const parent = Id.safeParse(form.get('parent'));
  if (!parent.success) return { error: 'Could not tell which step that was.' };
  const title = String(form.get('title') ?? '').trim();
  if (!title) return { error: 'Write the question first.' };
  if (title.length > STEP_TITLE_MAX) {
    return { error: `Keep the question under ${STEP_TITLE_MAX} characters.` };
  }
  try {
    const added = await insertStep(await createGoalsClient(), user.id, parent.data, {
      title,
      kind: 'decision',
    });
    if (!added) return { error: 'That step is no longer on the page.' };
  } catch {
    return { error: 'The question could not be saved. Try again.' };
  }
  return saved('Asked.');
}
