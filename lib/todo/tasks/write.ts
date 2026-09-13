import 'server-only';

import { z } from 'zod';
import { createTodoClient } from '@/lib/todo/auth/server';
import { SNOOZE_DAYS } from '@/lib/todo/tasks/model';
import { wallClockToInstant } from '@/lib/todo/time';

/**
 * Writing a task.
 *
 * Everything a form can send is parsed through Zod first, which is the house
 * rule for anything crossing into the database, and the shapes here are the
 * only place the two due columns are reconciled: a form offers one date field
 * and an optional time, and which column that lands in is decided once.
 */

/** A date field left blank arrives as ''. Treat it as absent, not as invalid. */
const optionalDate = z
  .string()
  .trim()
  .transform((value) => value || null)
  .pipe(z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a date like 2026-03-10').nullable());

const optionalTime = z
  .string()
  .trim()
  .transform((value) => value || null)
  .pipe(z.string().regex(/^\d{2}:\d{2}$/, 'Use a time like 14:30').nullable());

export const taskInput = z.object({
  title: z.string().trim().min(1, 'Give it a title.').max(500, 'That title is too long.'),
  body: z
    .string()
    .trim()
    .max(20_000)
    .transform((value) => value || null),
  dueOn: optionalDate,
  dueTime: optionalTime,
  pinned: z.boolean().default(false),
});

export type TaskInput = z.infer<typeof taskInput>;

/**
 * What an item under a task needs, which is a title and nothing else.
 *
 * Taken off taskInput rather than written again, so the one title rule -- not
 * blank, not longer than 500 -- is stated once and cannot drift between the
 * add bar and the box under a task.
 */
export const itemInput = taskInput.pick({ title: true });

export type ItemInput = z.infer<typeof itemInput>;

/**
 * The one place the date/instant split is decided.
 *
 * A day with no time is a `due_on`, which never moves. A day with a time is a
 * `due_at`, an instant, built by asking the reader's zone what that wall clock
 * means -- because "14:30 on Tuesday" is a promise about their clock, not
 * about UTC.
 *
 * A time with no day is not a due date at all. It could only mean "today at
 * 14:30", and quietly inventing the day is how a task ends up overdue the
 * moment it is written.
 */
export function resolveDue(
  input: Pick<TaskInput, 'dueOn' | 'dueTime'>,
  timezone: string,
): { due_on: string | null; due_at: string | null } {
  if (!input.dueOn) return { due_on: null, due_at: null };
  if (!input.dueTime) return { due_on: input.dueOn, due_at: null };

  return { due_on: null, due_at: wallClockToInstant(input.dueOn, input.dueTime, timezone) };
}

export async function createTask(
  userId: string,
  input: TaskInput,
  timezone: string,
): Promise<{ id: string | null; error: string | null }> {
  const supabase = await createTodoClient();

  const { data, error } = await supabase
    .from('tasks')
    .insert({
      user_id: userId,
      title: input.title,
      body: input.body,
      pinned: input.pinned,
      ...resolveDue(input, timezone),
    })
    .select('id')
    .single();

  return { id: (data?.id as string) ?? null, error: error?.message ?? null };
}

/**
 * Write one item under a task.
 *
 * Nothing but a title and the task it sits under: an item is written in the
 * middle of reading a list, and a form asking for a due date there would make
 * writing the next small thing down slower than not writing it down.
 *
 * A parent that belongs to somebody else, or that already sits under a task
 * itself, is refused by the trigger in migration 0006 rather than checked here.
 * The database is not the only caller's word for who owns what, and its
 * message is the one that comes back.
 */
export async function createItem(
  userId: string,
  parentId: string,
  input: ItemInput,
): Promise<{ id: string | null; error: string | null }> {
  const supabase = await createTodoClient();

  const { data, error } = await supabase
    .from('tasks')
    .insert({ user_id: userId, title: input.title, parent_id: parentId })
    .select('id')
    .single();

  return { id: (data?.id as string) ?? null, error: error?.message ?? null };
}

export async function updateTask(
  userId: string,
  id: string,
  input: TaskInput,
  timezone: string,
): Promise<{ error: string | null }> {
  const supabase = await createTodoClient();

  const { error } = await supabase
    .from('tasks')
    .update({
      title: input.title,
      body: input.body,
      pinned: input.pinned,
      ...resolveDue(input, timezone),
    })
    .eq('id', id)
    .eq('user_id', userId);

  return { error: error?.message ?? null };
}

/**
 * The two one-field writes the list itself makes.
 *
 * `updateTask` writes every column a task has, because it backs a form that
 * carries every one of them. Editing a title in the row cannot go through it:
 * the row knows the title and nothing else, so a rename through that path would
 * write a blank body and an unpinned pin over whatever was there. These write
 * the field that was edited and leave the rest of the row alone.
 *
 * Same schema pieces as the form, so "not blank, not longer than 500" and
 * "a date like 2026-03-10" are stated once and cannot drift between the two
 * ways in.
 */
export const renameInput = taskInput.pick({ title: true });
export const rescheduleInput = taskInput.pick({ dueOn: true, dueTime: true });

export async function renameTask(
  userId: string,
  id: string,
  title: string,
): Promise<{ error: string | null }> {
  const parsed = renameInput.safeParse({ title });
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  const supabase = await createTodoClient();
  const { error } = await supabase
    .from('tasks')
    .update({ title: parsed.data.title })
    .eq('id', id)
    .eq('user_id', userId);

  return { error: error?.message ?? null };
}

export async function rescheduleTask(
  userId: string,
  id: string,
  input: { dueOn: string; dueTime: string },
  timezone: string,
): Promise<{ error: string | null }> {
  const parsed = rescheduleInput.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  const supabase = await createTodoClient();
  const { error } = await supabase
    .from('tasks')
    // Both columns every time, through the one function that decides which of
    // them a day-and-maybe-a-time lands in. Clearing the date has to clear both
    // or a task with a time keeps it after its day is taken away.
    .update(resolveDue(parsed.data, timezone))
    .eq('id', id)
    .eq('user_id', userId);

  return { error: error?.message ?? null };
}

/**
 * Finish, drop, or reopen.
 *
 * `completed_at` and `dropped_at` are not set here. The database stamps them,
 * so there is no way for a caller to mark something done and leave it without
 * a time -- see the trigger in supabase/migrations-todo/0001_todo_schema.sql.
 */
export async function setTaskStatus(
  userId: string,
  id: string,
  status: 'open' | 'done' | 'dropped',
): Promise<{ error: string | null }> {
  const supabase = await createTodoClient();

  const { error } = await supabase
    .from('tasks')
    .update({ status })
    .eq('id', id)
    .eq('user_id', userId);

  return { error: error?.message ?? null };
}

/**
 * Tick a task off, and everything on its list with it.
 *
 * #261 settled that finishing the big thing finishes the small ones: ticking
 * six boxes to say one thing is done is a chore, and a finished task holding
 * open items reads as a bug.
 *
 * The ids of the items this actually ticked come back, because the way back
 * needs them. Reopening every item would un-tick ones that were already done
 * before the task was, and an undo that changes more than the thing it is
 * undoing is not one. Only the still-open ones are touched, for the same
 * reason.
 */
export async function completeTaskWithItems(
  userId: string,
  id: string,
): Promise<{ items: string[]; error: string | null }> {
  const supabase = await createTodoClient();

  // The task first: it is what was asked for, so if only one of the two writes
  // lands it should be that one.
  const { error } = await supabase
    .from('tasks')
    .update({ status: 'done' })
    .eq('id', id)
    .eq('user_id', userId);

  if (error) return { items: [], error: error.message };

  const { data, error: itemsError } = await supabase
    .from('tasks')
    .update({ status: 'done' })
    .eq('parent_id', id)
    .eq('user_id', userId)
    .eq('status', 'open')
    .select('id');

  if (itemsError) return { items: [], error: itemsError.message };

  return { items: (data ?? []).map((row) => row.id as string), error: null };
}

/** Put a task back on the list, with the items a tick took down with it. */
export async function reopenTaskWithItems(
  userId: string,
  id: string,
  items: readonly string[] = [],
): Promise<{ error: string | null }> {
  const supabase = await createTodoClient();

  const { error } = await supabase
    .from('tasks')
    .update({ status: 'open' })
    .in('id', [id, ...items])
    .eq('user_id', userId);

  return { error: error?.message ?? null };
}

export async function setTaskPinned(
  userId: string,
  id: string,
  pinned: boolean,
): Promise<{ error: string | null }> {
  const supabase = await createTodoClient();

  const { error } = await supabase
    .from('tasks')
    .update({ pinned })
    .eq('id', id)
    .eq('user_id', userId);

  return { error: error?.message ?? null };
}

/** "Later": out of sight for a week, still open, still due when it was due. */
export async function snoozeTask(
  userId: string,
  id: string,
  days = SNOOZE_DAYS,
): Promise<{ error: string | null }> {
  const until = new Date();
  until.setUTCDate(until.getUTCDate() + days);

  const supabase = await createTodoClient();
  const { error } = await supabase
    .from('tasks')
    .update({ snoozed_until: until.toISOString() })
    .eq('id', id)
    .eq('user_id', userId);

  return { error: error?.message ?? null };
}

export async function unsnoozeTask(userId: string, id: string): Promise<{ error: string | null }> {
  const supabase = await createTodoClient();
  const { error } = await supabase
    .from('tasks')
    .update({ snoozed_until: null })
    .eq('id', id)
    .eq('user_id', userId);

  return { error: error?.message ?? null };
}

/**
 * Put a pile in the order it is being looked at.
 *
 * Every task in the pile is numbered 1..n rather than the moved one being
 * squeezed between two neighbours. A personal pile is a handful of rows, so
 * the fractional-index machinery that exists to avoid renumbering a shared
 * unbounded list under concurrent writers would be paying for a problem this
 * does not have -- and renumbering leaves the column readable, which halves
 * the cost of the next bug in it.
 *
 * Each row is still scoped to the user, so a borrowed id from someone else's
 * account updates nothing rather than reordering their day.
 */
export async function reorderTasks(
  userId: string,
  ids: readonly string[],
): Promise<{ error: string | null }> {
  const supabase = await createTodoClient();

  const results = await Promise.all(
    ids.map((id, index) =>
      supabase
        .from('tasks')
        .update({ position: index + 1 })
        .eq('id', id)
        .eq('user_id', userId),
    ),
  );

  const failed = results.find((result) => result.error);
  return { error: failed?.error?.message ?? null };
}

export async function deleteTask(userId: string, id: string): Promise<{ error: string | null }> {
  const supabase = await createTodoClient();
  const { error } = await supabase.from('tasks').delete().eq('id', id).eq('user_id', userId);
  return { error: error?.message ?? null };
}
