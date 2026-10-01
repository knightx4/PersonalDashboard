import 'server-only';

import { createTodoClient } from '@/lib/todo/auth/server';
import { assertSchemaExposed } from '@/lib/core/db/schema-errors';
import { TODO_SCHEMA, type TodoSupabaseClient } from '@/lib/todo/db/schema-name';
import {
  TARGET_COLUMNS,
  LINK_TARGETS,
  type AppointmentRef,
  type LinkTarget,
  type TaskLink,
} from '@/lib/todo/links/model';
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

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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
    .eq('tasks.user_id', userId);

  if (target === 'appointment') {
    // The id is the feed_events row on screen, which the next refresh will
    // replace; the links name the appointment it is a copy of.
    const ref = await appointmentRefFor(targetId, supabase);
    if (!ref) return [];
    query = query.eq('feed_id', ref.feedId).eq('feed_uid', ref.uid);
    query =
      ref.occurrence === null
        ? query.is('feed_occurrence', null)
        : query.eq('feed_occurrence', ref.occurrence);
  } else {
    query = query.eq(TARGET_COLUMNS[target], targetId);
  }

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
export async function loadLinksForTasks(
  taskIds: string[],
  client?: TodoSupabaseClient,
): Promise<TaskLink[]> {
  if (taskIds.length === 0) return [];

  const supabase = client ?? (await createTodoClient());

  const { data, error } = await supabase
    .from('task_links')
    // Written out rather than built from TARGET_COLUMNS, and on one line
    // rather than concatenated: supabase-js parses this string at the type
    // level, and anything that is not a single literal degrades the whole
    // result to an error type. The list is checked against TARGET_COLUMNS by
    // lib/todo/links/load.test.ts instead, so the two cannot drift apart
    // silently.
    // prettier-ignore
    .select('task_id, relation, application_id, role_id, company_id, contact_id, interview_id, note_id, order_id, inventory_item_id, saved_item_id, reading_id, track_id, subject_id, goal_id, feed_id, saved_story_id, feed_uid, feed_occurrence, feed_title, feed_starts_on, feed_starts_at')
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
        ...(target === 'appointment'
          ? {
              appointment: {
                feedId: id,
                uid: row.feed_uid as string,
                occurrence: (row.feed_occurrence as string | null) ?? null,
                title: row.feed_title as string,
                startsOn: (row.feed_starts_on as string | null) ?? null,
                startsAt: (row.feed_starts_at as string | null) ?? null,
              },
            }
          : {}),
      });
      break;
    }
  }

  return links;
}

/**
 * What a link to the subscribed appointment in this feed_events row would
 * name: its subscription, UID and date, and the name and start it has now.
 * Null when the row is not the reader's or a refresh has already replaced it.
 */
export async function appointmentRefFor(
  feedEventId: string,
  client?: TodoSupabaseClient,
): Promise<AppointmentRef | null> {
  // The id comes from a query string or a form, so it is checked for being an
  // id before Postgres is asked, as loadFeedEvent does.
  if (!UUID.test(feedEventId)) return null;
  const supabase = client ?? (await createTodoClient());

  const { data, error } = await supabase
    .from('feed_events')
    .select('feed_id, uid, occurrence, title, starts_on, starts_at')
    .eq('id', feedEventId)
    .maybeSingle();

  assertSchemaExposed(error, TODO_SCHEMA);
  if (error || !data) return null;

  return {
    feedId: data.feed_id as string,
    uid: data.uid as string,
    occurrence: (data.occurrence as string | null) ?? null,
    title: data.title as string,
    startsOn: (data.starts_on as string | null) ?? null,
    startsAt: (data.starts_at as string | null) ?? null,
  };
}
