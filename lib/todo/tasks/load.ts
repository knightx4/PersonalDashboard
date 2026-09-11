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

/** Every open task. Bucketing and ordering happen in model.ts. */
export async function loadOpenTasks(userId: string): Promise<Task[]> {
  const supabase = await createTodoClient();

  const { data, error } = await supabase
    .from('tasks')
    .select(COLUMNS)
    .eq('user_id', userId)
    .eq('status', 'open')
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
