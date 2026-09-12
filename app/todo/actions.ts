'use server';

import { revalidatePath } from 'next/cache';
import { requireUser } from '@/lib/auth/server';
import { loadAccountSettings } from '@/lib/core/account/settings';
import { isLinkTarget } from '@/lib/todo/links/model';
import { clearTaskAbout, linkTask, setTaskAbout } from '@/lib/todo/links/write';
import { resolveRelativeDay, todayIn } from '@/lib/todo/tasks/model';
import {
  completeTaskWithItems,
  createItem,
  createTask,
  deleteTask,
  itemInput,
  reopenTaskWithItems,
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

/**
 * `today` is the account's own day. A form that the server rendered sends a
 * date and never needs it; one that was not -- the capture panel, which is
 * mounted in the shell -- sends the word "today" or "tomorrow" instead,
 * because a browser cannot work out which day it is on somebody else's list.
 * See resolveRelativeDay.
 */
function parse(formData: FormData, today: string) {
  return taskInput.safeParse({
    title: formData.get('title') ?? '',
    body: formData.get('body') ?? '',
    dueOn: resolveRelativeDay(String(formData.get('dueOn') ?? ''), today),
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
// latency: pending
export async function addTask(
  _prev: TaskFormState,
  formData: FormData,
): Promise<TaskFormState> {
  const user = await requireUser();
  const { timezone } = await loadAccountSettings(user.id);

  const parsed = parse(formData, todayIn(timezone));
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  const target = String(formData.get('linkTarget') ?? '');
  const targetId = String(formData.get('linkTargetId') ?? '');
  // Half an answer is not one. A target with no id, or an id with a target
  // this app has no column for, is a broken request rather than a plain task.
  if ((target || targetId) && !(isLinkTarget(target) && targetId)) {
    return { error: 'Which thing is this about?' };
  }

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

// latency: pending
export async function editTask(
  _prev: TaskFormState,
  formData: FormData,
): Promise<TaskFormState> {
  const id = String(formData.get('id') ?? '');
  if (!id) return { error: 'Which task?' };

  const user = await requireUser();
  const { timezone } = await loadAccountSettings(user.id);

  const parsed = parse(formData, todayIn(timezone));
  if (!parsed.success) return { error: parsed.error.issues[0].message };

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
// latency: pending
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

// latency: pending
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
 *
 * Each returns the write's error, the same shape as `pointTaskAt` above. A row
 * that drew the change before the round trip finished needs the error to put
 * itself back; a caller that does not draw ahead can ignore it.
 */
/**
 * Tick a task off, and its items with it.
 *
 * `items` is what the tick actually changed, and the caller passes it back to
 * `reopenTask` as the undo. Items that were already ticked are not in it and
 * are left alone, so undoing puts the list back exactly as it was.
 */
// latency: optimistic -- the checkbox fills before the write returns
export async function completeTask(
  id: string,
): Promise<{ error: string | null; items: string[] }> {
  const user = await requireUser();
  const { items, error } = await completeTaskWithItems(user.id, id);
  if (error) return { error, items: [] };

  revalidateTodo();
  return { error: null, items };
}

/**
 * Put a task back on the list.
 *
 * `items` are the ones a tick took down with it, sent back by the undo in the
 * toast. Nothing is trusted about them beyond their being ids: the write is
 * scoped to this session's user, so a borrowed id reopens nothing.
 */
// latency: optimistic -- the same checkbox, the other way
export async function reopenTask(
  id: string,
  items: string[] = [],
): Promise<{ error: string | null }> {
  const user = await requireUser();
  const { error } = await reopenTaskWithItems(user.id, id, items);
  if (error) return { error };

  revalidateTodo();
  return { error: null };
}

/**
 * Write one more item under a task.
 *
 * The box under a list sends a title and the task it belongs to. Whether that
 * task is yours, and whether it is allowed to hold a list at all, is the
 * database's answer rather than this function's -- see migration 0006 -- and
 * its message is what comes back.
 */
// latency: pending
export async function addItem(parentId: string, title: string): Promise<{ error: string | null }> {
  const user = await requireUser();
  if (!parentId) return { error: 'Which task?' };

  const parsed = itemInput.safeParse({ title });
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  const { error } = await createItem(user.id, parentId, parsed.data);
  if (error) return { error };

  revalidateTodo();
  return { error: null };
}

// latency: optimistic -- the row strikes through before the write returns
export async function dropTask(id: string): Promise<{ error: string | null }> {
  const user = await requireUser();
  const { error } = await setTaskStatus(user.id, id, 'dropped');
  if (error) return { error };

  revalidateTodo();
  return { error: null };
}

// latency: optimistic -- the pin appears before the write returns
export async function pinTask(id: string, pinned: boolean): Promise<{ error: string | null }> {
  const user = await requireUser();
  const { error } = await setTaskPinned(user.id, id, pinned);
  if (error) return { error };

  revalidateTodo();
  return { error: null };
}

// latency: optimistic -- the row offers "bring back" before the write returns
export async function laterTask(id: string): Promise<{ error: string | null }> {
  const user = await requireUser();
  const { error } = await snoozeTask(user.id, id);
  if (error) return { error };

  revalidateTodo();
  return { error: null };
}

// latency: optimistic -- the same button, the other way
export async function bringBackTask(id: string): Promise<{ error: string | null }> {
  const user = await requireUser();
  const { error } = await unsnoozeTask(user.id, id);
  if (error) return { error };

  revalidateTodo();
  return { error: null };
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
// latency: pending
export async function moveTask(
  id: string,
  direction: 'up' | 'down',
  pile: string[],
): Promise<{ error: string | null }> {
  const from = pile.indexOf(id);
  if (from === -1) return { error: 'That task is not in this list.' };

  // Already at the top or the bottom. Nothing to write, and nothing wrong.
  const to = direction === 'up' ? from - 1 : from + 1;
  if (to < 0 || to >= pile.length) return { error: null };

  const next = [...pile];
  [next[from], next[to]] = [next[to], next[from]];

  const user = await requireUser();
  const { error } = await reorderTasks(user.id, next);
  if (error) return { error };

  revalidateTodo();
  return { error: null };
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
// latency: pending
export async function placeTask(
  id: string,
  before: string | null,
  pile: string[],
): Promise<{ error: string | null }> {
  if (id === before) return { error: null };
  if (!pile.includes(id)) return { error: 'That task is not in this list.' };

  const rest = pile.filter((other) => other !== id);
  const at = before === null ? rest.length : rest.indexOf(before);
  // The neighbour it was dropped above has gone, so the pile is not the one
  // the sender was looking at and where they meant is no longer knowable.
  if (at === -1) return { error: 'This list has changed. Try that again.' };

  const next = [...rest.slice(0, at), id, ...rest.slice(at)];
  if (next.every((value, index) => value === pile[index])) return { error: null };

  const user = await requireUser();
  const { error } = await reorderTasks(user.id, next);
  if (error) return { error };

  revalidateTodo();
  return { error: null };
}

// latency: pending
export async function removeTask(id: string): Promise<{ error: string | null }> {
  const user = await requireUser();
  const { error } = await deleteTask(user.id, id);
  if (error) return { error };

  revalidateTodo();
  return { error: null };
}
