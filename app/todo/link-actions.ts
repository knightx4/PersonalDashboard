'use server';

import { revalidatePath } from 'next/cache';
import { requireUser } from '@/lib/auth/server';
import { loadAccountSettings } from '@/lib/core/account/settings';
import { isLinkTarget, type LinkTarget } from '@/lib/todo/links/model';
import { linkTask, unlinkTask } from '@/lib/todo/links/write';
import { createTask, taskInput } from '@/lib/todo/tasks/write';
import { setTaskStatus } from '@/lib/todo/tasks/write';

export interface LinkedTaskState {
  error?: string;
  message?: string;
}

/**
 * Add a task from inside whatever it is about.
 *
 * The whole point of the inline sections: you are looking at a role, you think
 * of something, and you should not have to change workspaces to write it down.
 * So this is one field and a button, and the link is implied by where you are.
 *
 * If the link fails the task is deleted rather than left floating -- a task
 * created from a role page and silently not attached to it is worse than no
 * task, because it is invisible from the place you were looking.
 */
export async function addLinkedTask(
  _prev: LinkedTaskState,
  formData: FormData,
): Promise<LinkedTaskState> {
  const target = String(formData.get('target') ?? '');
  const targetId = String(formData.get('targetId') ?? '');
  const returnTo = String(formData.get('returnTo') ?? '');

  if (!isLinkTarget(target) || !targetId) return { error: 'Which thing is this about?' };

  const parsed = taskInput.safeParse({
    title: formData.get('title') ?? '',
    body: '',
    dueOn: formData.get('dueOn') ?? '',
    dueTime: '',
    pinned: false,
  });
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  const user = await requireUser();
  const { timezone } = await loadAccountSettings(user.id);

  const { id, error } = await createTask(user.id, parsed.data, timezone);
  if (error || !id) return { error: error ?? 'Could not add that.' };

  const link = await linkTask(id, target as LinkTarget, targetId);
  if (link.error) {
    await setTaskStatus(user.id, id, 'dropped');
    return { error: link.error };
  }

  revalidateFor(returnTo);
  return { message: 'Added.' };
}

export async function detachTask(
  taskId: string,
  target: string,
  targetId: string,
  returnTo: string,
): Promise<void> {
  await requireUser();
  if (!isLinkTarget(target)) return;

  await unlinkTask(taskId, target as LinkTarget, targetId);
  revalidateFor(returnTo);
}

/**
 * The page the section is on, plus the agenda.
 *
 * `returnTo` is a path from the caller rather than a guess: the sections live
 * in four workspaces and this module has no business knowing their URL shapes.
 * Only a path is accepted, so a value from a request cannot revalidate
 * something arbitrary.
 */
function revalidateFor(returnTo: string): void {
  if (returnTo.startsWith('/') && !returnTo.startsWith('//')) revalidatePath(returnTo);
  revalidatePath('/todo');
  revalidatePath('/home');
}
