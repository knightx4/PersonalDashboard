'use server';

import { revalidatePath } from 'next/cache';
import { requireUser } from '@/lib/auth/server';
import { loadAccountSettings } from '@/lib/core/account/settings';
import { isLinkTarget } from '@/lib/todo/links/model';
import { clearTaskAbout, linkTask, setTaskAbout } from '@/lib/todo/links/write';
import {
  createTask,
  deleteTask,
  reorderTasks,
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

/**
 * Add a task, and say what it is about in the same breath.
 *
 * The picker beside the title field submits a target and an id, or two empty
 * strings. Empty is the ordinary case and behaves exactly as it did before any
 * of this existed.
 *
 * When there is one, the task and its link are written in that order, because
 * a link needs a task to hang off. If the link is refused -- the trigger
 * checking that the target is yours is the reason it can be -- the task is
 * deleted rather than left floating: it is a task you never wrote, attached to
 * nothing, and the message you get back is the database's own words rather
 * than "Something went wrong".
 */
export async function addTask(
  _prev: TaskFormState,
  formData: FormData,
): Promise<TaskFormState> {
  const parsed = parse(formData);
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  const target = String(formData.get('linkTarget') ?? '');
  const targetId = String(formData.get('linkTargetId') ?? '');
  // Half an answer is not one. A target with no id, or an id with a target
  // this app has no column for, is a broken request rather than a plain task.
  if ((target || targetId) && !(isLinkTarget(target) && targetId)) {
    return { error: 'Which thing is this about?' };
  }

  const user = await requireUser();
  const { timezone } = await loadAccountSettings(user.id);

  const { id, error } = await createTask(user.id, parsed.data, timezone);
  if (error) return { error };

  if (isLinkTarget(target) && targetId && id) {
    const link = await linkTask(id, target, targetId);
    if (link.error) {
      await deleteTask(user.id, id);
      return { error: link.error };
    }
  }

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
 * Point a task at something, or at nothing, from the list it is already in.
 *
 * Most tasks are written before anybody knows what they are about, so the
 * anchor has to be addable afterwards. Both take the task id and re-read the
 * user from the session; the row can only be one you own, because RLS on
 * task_links asks who owns the task and the trigger asks who owns the target.
 *
 * They return the message rather than throwing it, because the one failure
 * worth reading -- pointing at somebody else's row -- has words of its own.
 */
export async function pointTaskAt(
  taskId: string,
  target: string,
  targetId: string,
): Promise<{ error: string | null }> {
  await requireUser();
  if (!isLinkTarget(target) || !targetId) return { error: 'Which thing is this about?' };

  const { error } = await setTaskAbout(taskId, target, targetId);
  if (error) return { error };

  revalidateTodo();
  return { error: null };
}

export async function unpointTask(taskId: string): Promise<{ error: string | null }> {
  await requireUser();

  const { error } = await clearTaskAbout(taskId);
  if (error) return { error };

  revalidateTodo();
  return { error: null };
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

/**
 * Move one task up or down within the pile it is in.
 *
 * The caller sends the pile as it is on screen, because the screen is the only
 * place that order exists before this is called -- the pile is worked out from
 * dates at render time, not stored. Nothing is trusted about the ids beyond
 * their being ids: every row written is scoped to this session's user, so the
 * worst a made-up list can do is number tasks the sender already owns.
 */
export async function moveTask(
  id: string,
  direction: 'up' | 'down',
  pile: string[],
): Promise<void> {
  const from = pile.indexOf(id);
  const to = direction === 'up' ? from - 1 : from + 1;
  if (from === -1 || to < 0 || to >= pile.length) return;

  const next = [...pile];
  [next[from], next[to]] = [next[to], next[from]];

  const user = await requireUser();
  await reorderTasks(user.id, next);
  revalidateTodo();
}

/**
 * Drop a task somewhere in its pile.
 *
 * `before` is the task it should land above, or null for the foot of the pile.
 * A neighbour rather than an index, because an index is only true of the list
 * the sender was looking at: if the pile moved under them, an index silently
 * puts the task somewhere else, while a neighbour that is no longer there is
 * a request this can decline.
 *
 * The same trust story as `moveTask`: the pile is the caller's, and every row
 * written is scoped to this session's user.
 */
export async function placeTask(
  id: string,
  before: string | null,
  pile: string[],
): Promise<void> {
  if (id === before || !pile.includes(id)) return;

  const rest = pile.filter((other) => other !== id);
  const at = before === null ? rest.length : rest.indexOf(before);
  if (at === -1) return;

  const next = [...rest.slice(0, at), id, ...rest.slice(at)];
  if (next.every((value, index) => value === pile[index])) return;

  const user = await requireUser();
  await reorderTasks(user.id, next);
  revalidateTodo();
}

export async function removeTask(id: string): Promise<void> {
  const user = await requireUser();
  await deleteTask(user.id, id);
  revalidateTodo();
}
