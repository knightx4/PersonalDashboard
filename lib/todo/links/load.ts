import 'server-only';

import { createTodoClient } from '@/lib/todo/auth/server';
import { assertSchemaExposed } from '@/lib/core/db/schema-errors';
import { TODO_SCHEMA } from '@/lib/todo/db/schema-name';
import { TARGET_COLUMNS, LINK_TARGETS, type LinkTarget, type TaskLink } from '@/lib/todo/links/model';
import type { Task, TaskStatus } from '@/lib/todo/tasks/model';

/**
 * "What is outstanding on this role" -- the read the inline sections make.
 *
 * PostgREST cannot embed across schemas, and a client is bound to one schema
 * anyway, so this reads links and tasks together within `todo` and leaves the
 * other side to whoever is already rendering it. The role page knows the role's
 * name; it does not need this module to tell it.
 */

const TASK_COLUMNS =
  'id, title, body, status, due_on, due_at, pinned, snoozed_until, completed_at, created_at, position, parent_id';

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
 * Tasks attached to one thing.
 *
 * Open ones by default. A role page showing six months of finished follow-ups
 * under "Tasks" is an archive nobody asked for in the middle of a page about
 * something else.
 */
export async function loadTasksFor(
  userId: string,
  target: LinkTarget,
  targetId: string,
  opts: { includeFinished?: boolean } = {},
): Promise<Task[]> {
  const supabase = await createTodoClient();

  let query = supabase
    .from('task_links')
    .select(`task_id, tasks!inner (${TASK_COLUMNS})`)
    .eq(TARGET_COLUMNS[target], targetId)
    .eq('tasks.user_id', userId);

  if (!opts.includeFinished) query = query.eq('tasks.status', 'open');

  const { data, error } = await query;

  assertSchemaExposed(error, TODO_SCHEMA);
  if (error) throw new Error(error.message);

  const seen = new Set<string>();
  const tasks: Task[] = [];

  for (const row of (data ?? []) as Row[]) {
    // A task may be both `about` this thing and cite it as a `source`, which is
    // two link rows and one task. Showing it twice would be a bug of the kind
    // that only appears once promotion exists, so it is handled now.
    const embedded = row.tasks as Row | Row[] | null;
    const task = Array.isArray(embedded) ? embedded[0] : embedded;
    if (!task) continue;
    if (seen.has(task.id as string)) continue;
    seen.add(task.id as string);
    tasks.push(toTask(task));
  }

  return tasks;
}

/**
 * Every link belonging to a set of tasks, so the agenda can label its rows.
 *
 * One query for the whole page, not one per row: the naive shape resolves each
 * task's anchor as it renders, which is a query per row and does not look slow
 * until the list is long.
 */
export async function loadLinksForTasks(taskIds: string[]): Promise<TaskLink[]> {
  if (taskIds.length === 0) return [];

  const supabase = await createTodoClient();

  const { data, error } = await supabase
    .from('task_links')
    // Written out rather than built from TARGET_COLUMNS, and on one line
    // rather than concatenated: supabase-js parses this string at the type
    // level, and anything that is not a single literal degrades the whole
    // result to an error type. The list is checked against TARGET_COLUMNS by
    // lib/todo/links/load.test.ts instead, so the two cannot drift apart
    // silently.
    // prettier-ignore
    .select('task_id, relation, application_id, role_id, company_id, contact_id, interview_id, note_id, order_id, inventory_item_id, saved_item_id, reading_id, track_id, subject_id')
    .in('task_id', taskIds);

  assertSchemaExposed(error, TODO_SCHEMA);
  if (error) throw new Error(error.message);

  const links: TaskLink[] = [];

  for (const row of (data ?? []) as Row[]) {
    for (const target of LINK_TARGETS) {
      const id = row[TARGET_COLUMNS[target]] as string | null;
      if (!id) continue;
      links.push({
        taskId: row.task_id as string,
        relation: row.relation as TaskLink['relation'],
        target,
        targetId: id,
      });
      break;
    }
  }

  return links;
}
