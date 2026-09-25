'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createClient, requireUser } from '@/lib/auth/server';
import { isOwner } from '@/lib/dev/owner';
import { goalsRoutine } from '@/lib/feedback/routine';
import { createGoalsClient } from '@/lib/goals/auth/server';
import { answerGoalFlag, deleteFlagComment, dismissGoalFlag } from '@/lib/goals/flags-store';

/**
 * Answering, and putting aside, what a goals run flagged on a goal (plan
 * #1015). The answer box is the dev pages' thread
 * (components/dev/comment-thread.tsx), so the fields are its: `id` is the
 * flag, `body` the answer. Everything an answer sets off is in
 * lib/goals/flags-store.ts.
 */

export type FlagActionState = { error?: string; message?: string };

const Id = z.string().uuid();
const Body = z.string().trim().min(1, 'Write something.').max(4000);

function redraw() {
  revalidatePath('/goals', 'layout');
}

// latency: pending
export async function answerFlagAction(
  _prev: FlagActionState,
  form: FormData,
): Promise<FlagActionState> {
  const user = await requireUser();
  const id = Id.safeParse(form.get('id'));
  const body = Body.safeParse(form.get('body') ?? '');
  if (!id.success) return { error: 'Could not tell which flag that was.' };
  if (!body.success) return { error: body.error.issues[0].message };

  const outcome = await answerGoalFlag({
    supabase: await createClient(),
    client: await createGoalsClient(),
    userId: user.id,
    id: id.data,
    answer: body.data,
    canRun: await isOwner({ user }),
    routine: goalsRoutine(),
  });
  redraw();
  return outcome.ok ? { message: outcome.message } : { error: outcome.error };
}

// latency: pending
export async function deleteFlagCommentAction(
  _prev: FlagActionState,
  form: FormData,
): Promise<FlagActionState> {
  const user = await requireUser();
  const id = Id.safeParse(form.get('id'));
  if (!id.success) return { error: 'Could not tell which comment that was.' };
  try {
    if (!(await deleteFlagComment(await createClient(), user.id, id.data))) {
      return { error: 'That comment is already gone.' };
    }
  } catch {
    return { error: 'The comment could not be deleted. Try again.' };
  }
  redraw();
  return { message: 'Deleted.' };
}

// latency: pending
export async function dismissFlagAction(
  _prev: FlagActionState,
  form: FormData,
): Promise<FlagActionState> {
  const user = await requireUser();
  const id = Id.safeParse(form.get('id'));
  if (!id.success) return { error: 'Could not tell which flag that was.' };
  try {
    if (!(await dismissGoalFlag(await createClient(), user.id, id.data))) {
      return { error: 'That flag is no longer waiting on you.' };
    }
  } catch {
    return { error: 'The flag could not be put aside. Try again.' };
  }
  redraw();
  return { message: 'Put aside.' };
}
