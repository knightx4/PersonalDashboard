import 'server-only';

import { z } from 'zod';
import { createTodoClient } from '@/lib/todo/auth/server';
import { SNOOZE_DAYS } from '@/lib/todo/tasks/model';

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

/**
 * A wall clock in a zone, as an instant.
 *
 * Done by measuring the zone's offset at roughly the right moment rather than
 * by shipping a timezone database: format the candidate instant in the target
 * zone, see how far the result is from what was asked for, and shift by the
 * difference. lib/jobs/calendar/ics.ts does the same thing for the same reason.
 *
 * The measurement is taken twice because the offset can itself change across
 * the shift -- on the two days a year a clock goes forward or back, the first
 * guess lands on the wrong side of the change.
 */
export function wallClockToInstant(day: string, time: string, timezone: string): string {
  const wanted = Date.parse(`${day}T${time}:00Z`);
  let instant = wanted;

  for (let pass = 0; pass < 2; pass += 1) {
    const offset = offsetOf(new Date(instant), timezone);
    const next = wanted - offset;
    if (next === instant) break;
    instant = next;
  }

  return new Date(instant).toISOString();
}

/** How far ahead of UTC a zone is, in milliseconds, at a given instant. */
function offsetOf(at: Date, timezone: string): number {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(at);

  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? '00';
  const local = Date.parse(
    `${get('year')}-${get('month')}-${get('day')}T${get('hour')}:${get('minute')}:${get('second')}Z`,
  );

  return local - at.getTime();
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
