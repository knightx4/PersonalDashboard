'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { requireUser } from '@/lib/auth/server';
import { loadAccountSettings } from '@/lib/core/account/settings';
import { isOwner } from '@/lib/dev/owner';
import { serverEnv } from '@/lib/env';
import { goalsRoutine } from '@/lib/feedback/routine';
import { mentionsDash, questionFrom } from '@/lib/comments/mention';
import { askDashOnGoal } from '@/lib/goals/ask';
import { createGoalsClient } from '@/lib/goals/auth/server';
import { COMMENT_MAX } from '@/lib/goals/comments';
import { deleteComment, goalOfItem, writeComment } from '@/lib/goals/comments-store';
import { todayIn } from '@/lib/todo/tasks/model';

/**
 * Writing and removing a comment on a goal or a step (plan #957). The same
 * form the dev pages' thread posts (components/dev/comment-thread.tsx), so the
 * fields are its: `id` is the goal or step, `body` the words. A comment
 * tagged @dash gets a reply in the thread before this returns, or a note that
 * the goals routine is on it.
 */

export type GoalCommentState = { error?: string; message?: string };

const Id = z.string().uuid();
const Body = z.string().trim().min(1, 'Write something.').max(COMMENT_MAX);

function apiKey(): string | null {
  try {
    return serverEnv().ANTHROPIC_API_KEY ?? null;
  } catch {
    return process.env.ANTHROPIC_API_KEY ?? null;
  }
}

function redraw(goalId?: string) {
  if (goalId) revalidatePath(`/goals/${goalId}`);
  else revalidatePath('/goals', 'layout');
}

// latency: pending
export async function addGoalComment(
  _prev: GoalCommentState,
  form: FormData,
): Promise<GoalCommentState> {
  const user = await requireUser();
  const id = Id.safeParse(form.get('id'));
  const body = Body.safeParse(form.get('body') ?? '');
  if (!id.success) return { error: 'Could not tell what the comment is about.' };
  if (!body.success) return { error: body.error.issues[0].message };

  const client = await createGoalsClient();
  const owner = await goalOfItem(client, id.data);
  if (!owner) return { error: 'That goal or step is no longer on the page.' };

  let commentId: string;
  try {
    commentId = await writeComment(client, {
      userId: user.id,
      itemId: id.data,
      author: 'me',
      body: body.data,
    });
  } catch {
    return { error: 'The comment could not be saved. Try again.' };
  }

  // Untagged, it is a note on the row and nothing reads it.
  if (!mentionsDash(body.data)) {
    redraw(owner.goalId);
    return { message: 'Saved.' };
  }

  const account = await loadAccountSettings(user.id);
  const asked = await askDashOnGoal({
    client,
    claude: await createGoalsClient({ actor: 'claude' }),
    userId: user.id,
    today: todayIn(account.timezone),
    goalId: owner.goalId,
    itemId: id.data,
    itemTitle: owner.title,
    commentId,
    question: questionFrom(body.data),
    apiKey: apiKey(),
    canRun: await isOwner({ user }),
    routine: goalsRoutine(),
  });

  // One redraw after the reply, so the question and its answer arrive
  // together. A message either way: the comment is written, and when no reply
  // could be produced the thread says why.
  redraw(owner.goalId);
  return { message: asked.ok ? asked.message : asked.error };
}

// latency: pending
export async function deleteGoalComment(
  _prev: GoalCommentState,
  form: FormData,
): Promise<GoalCommentState> {
  await requireUser();
  const id = Id.safeParse(form.get('id'));
  if (!id.success) return { error: 'Could not tell which comment that was.' };
  try {
    if (!(await deleteComment(await createGoalsClient(), id.data))) {
      return { error: 'That comment is already gone.' };
    }
  } catch {
    return { error: 'The comment could not be deleted. Try again.' };
  }
  redraw();
  return { message: 'Deleted.' };
}
