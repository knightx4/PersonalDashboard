'use server';

import { revalidatePath } from 'next/cache';
import { requireUser } from '@/lib/auth/server';
import { loadAccountSettings } from '@/lib/core/account/settings';
import {
  createTask,
  deleteTask,
  setTaskPinned,
  setTaskStatus,
  snoozeTask,
  taskInput,
  unsnoozeTask,
  updateTask,
} from '@/lib/todo/tasks/write';

export interface TaskFormState {
  error?: string;
  message?: string;
}

/**
 * Every page in the workspace shows the same list, so every write invalidates
 * all of them rather than guessing which one the person is looking at.
 */
function revalidateTodo(): void {
  revalidatePath('/todo');
  revalidatePath('/todo/all');
  revalidatePath('/home');
}

function parse(formData: FormData) {
  return taskInput.safeParse({
    title: formData.get('title') ?? '',
    body: formData.get('body') ?? '',
    dueOn: formData.get('dueOn') ?? '',
    dueTime: formData.get('dueTime') ?? '',
    pinned: formData.get('pinned') === 'on',
  });
}

export async function addTask(
  _prev: TaskFormState,
  formData: FormData,
): Promise<TaskFormState> {
  const parsed = parse(formData);
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  const user = await requireUser();
  const { timezone } = await loadAccountSettings(user.id);

  const { error } = await createTask(user.id, parsed.data, timezone);
  if (error) return { error };

  revalidateTodo();
  return { message: 'Added.' };
}

export async function editTask(
  _prev: TaskFormState,
  formData: FormData,
): Promise<TaskFormState> {
  const id = String(formData.get('id') ?? '');
  if (!id) return { error: 'Which task?' };

  const parsed = parse(formData);
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  const user = await requireUser();
  const { timezone } = await loadAccountSettings(user.id);

  const { error } = await updateTask(user.id, id, parsed.data, timezone);
  if (error) return { error };

  revalidateTodo();
  return { message: 'Saved.' };
}

/**
 * The row actions.
 *
 * Each takes the id and nothing else, and each re-reads the user from the
 * session. Never from the form: an id in a request body is a request, and the
 * account it belongs to is not something a request gets to assert.
 */
export async function completeTask(id: string): Promise<void> {
  const user = await requireUser();
  await setTaskStatus(user.id, id, 'done');
  revalidateTodo();
}

export async function reopenTask(id: string): Promise<void> {
  const user = await requireUser();
  await setTaskStatus(user.id, id, 'open');
  revalidateTodo();
}

export async function dropTask(id: string): Promise<void> {
  const user = await requireUser();
  await setTaskStatus(user.id, id, 'dropped');
  revalidateTodo();
}

export async function pinTask(id: string, pinned: boolean): Promise<void> {
  const user = await requireUser();
  await setTaskPinned(user.id, id, pinned);
  revalidateTodo();
}

export async function laterTask(id: string): Promise<void> {
  const user = await requireUser();
  await snoozeTask(user.id, id);
  revalidateTodo();
}

export async function bringBackTask(id: string): Promise<void> {
  const user = await requireUser();
  await unsnoozeTask(user.id, id);
  revalidateTodo();
}

export async function removeTask(id: string): Promise<void> {
  const user = await requireUser();
  await deleteTask(user.id, id);
  revalidateTodo();
}
