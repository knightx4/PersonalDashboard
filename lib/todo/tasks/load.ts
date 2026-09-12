import 'server-only';

import { createTodoClient } from '@/lib/todo/auth/server';
import { assertSchemaExposed } from '@/lib/core/db/schema-errors';
import { TODO_SCHEMA } from '@/lib/todo/db/schema-name';
import type { Task, TaskStatus } from '@/lib/todo/tasks/model';

/**
 * Reading the list. The deciding is next door in model.ts, on purpose.
 */

const COLUMNS =
  'id, title, body, status, due_on, due_at, pinned, snoozed_until, completed_at, created_at, position, parent_id';

/** PostgREST caps a response; a personal list will not reach this, but say it. */
const LIMIT = 500;

type Row = Record<string, unknown>;

function toTask(row: Row): Task {
  return {
    id: row.id as string,
    title: row.title as string,
    body: (row.body as string | null) ?? null,
    status: row.status as TaskStatus,
    dueOn: (row.due_on as string | null) ?? null,
    dueAt: (row.due_at as string | null) ?? null,
    pinned: Boolean(row.pinned),
    snoozedUntil: (row.snoozed_until as string | null) ?? null,
    completedAt: (row.completed_at as string | null) ?? null,
    createdAt: row.created_at as string,
    position: (row.position as number | null) ?? null,
    parentId: (row.parent_id as string | null) ?? null,
  };
}

/**
 * Every open task, and every ticked item sitting under one.
 *
 * A ticked item still belongs on the list it is part of -- "2 of 5" needs the
 * three that are done, and crossing one out in place is how you can see the
 * list shrinking. Only items are fetched done: a whole task that is finished
 * belongs to the archive. Bucketing and grouping happen in model.ts.
 */
export async function loadOpenTasks(userId: string): Promise<Task[]> {
  const supabase = await createTodoClient();

  const { data, error } = await supabase
    .from('tasks')
    .select(COLUMNS)
    .eq('user_id', userId)
    .or('status.eq.open,and(status.eq.done,parent_id.not.is.null)')
    .limit(LIMIT);

  assertSchemaExposed(error, TODO_SCHEMA);
  if (error) throw new Error(error.message);

  return (data ?? []).map(toTask);
}

export interface AllTasksFilter {
  status?: TaskStatus | 'all';
  search?: string;
}

/**
 * The archive, on /todo/all.
 *
 * Ordered newest first here rather than in model.ts because this list is not
 * bucketed -- it is a history, and a history is read in the order it happened.
 */
export async function loadAllTasks(userId: string, filter: AllTasksFilter = {}): Promise<Task[]> {
  const supabase = await createTodoClient();

  let query = supabase.from('tasks').select(COLUMNS).eq('user_id', userId);

  if (filter.status && filter.status !== 'all') query = query.eq('status', filter.status);

  const search = filter.search?.trim();
  // Escaping the wildcards: a title containing '%' is a title, not a pattern,
  // and a search for it must not match everything.
  if (search) query = query.ilike('title', `%${search.replace(/[%_\\]/g, '\\$&')}%`);

  const { data, error } = await query.order('created_at', { ascending: false }).limit(LIMIT);

  assertSchemaExposed(error, TODO_SCHEMA);
  if (error) throw new Error(error.message);

  return (data ?? []).map(toTask);
}

/**
 * The titles of the tasks a list of tasks sit under.
 *
 * For a list that is not nested: the archive shows every row in its own right,
 * and an item there is a line with no context unless it can say what it came
 * out of. One query for the whole page rather than one per row, the same shape
 * resolveAnchors uses for what a task is about, and for the same reason.
 *
 * Keyed by the item's own id, because that is what the row rendering it has.
 */
export async function loadParentTitles(
  userId: string,
  tasks: Task[],
): Promise<Map<string, string>> {
  const parentIds = [...new Set(tasks.map((task) => task.parentId).filter((id) => id !== null))];
  if (parentIds.length === 0) return new Map();

  const supabase = await createTodoClient();

  const { data, error } = await supabase
    .from('tasks')
    .select('id, title')
    .eq('user_id', userId)
    .in('id', parentIds);

  assertSchemaExposed(error, TODO_SCHEMA);
  if (error) throw new Error(error.message);

  const titles = new Map((data ?? []).map((row) => [row.id as string, row.title as string]));

  return new Map(
    tasks
      .filter((task) => task.parentId !== null && titles.has(task.parentId))
      .map((task) => [task.id, titles.get(task.parentId!)!]),
  );
}

export async function loadTask(userId: string, id: string): Promise<Task | null> {
  const supabase = await createTodoClient();

  const { data, error } = await supabase
    .from('tasks')
    .select(COLUMNS)
    .eq('user_id', userId)
    .eq('id', id)
    .maybeSingle();

  assertSchemaExposed(error, TODO_SCHEMA);
  if (error) throw new Error(error.message);

  return data ? toTask(data) : null;
}

/** How many are open and not deferred — for the nav badge and the home slice. */
export async function countOpenTasks(userId: string): Promise<number> {
  const supabase = await createTodoClient();

  const { count, error } = await supabase
    .from('tasks')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId)
    .eq('status', 'open')
    .or(`snoozed_until.is.null,snoozed_until.lte.${new Date().toISOString()}`);

  assertSchemaExposed(error, TODO_SCHEMA);
  return count ?? 0;
}
