import 'server-only';

import { createTodoClient } from '@/lib/todo/auth/server';
import {
  LINK_TARGETS,
  TARGET_COLUMNS,
  type LinkRelation,
  type LinkTarget,
} from '@/lib/todo/links/model';

/**
 * Linking a task to what it is about.
 *
 * There is no ownership check in here, deliberately. It is in the database, as
 * a trigger, because a foreign key is not an ownership check -- Postgres
 * performs referential integrity checks bypassing row level security, so the
 * key to job_search.roles is satisfied by any role in the table, including
 * another account's. A check written here would be one a future caller could
 * forget to make; one written there cannot be reached around.
 *
 * So the error surfaced below is a real answer from the database, not a
 * fallback for one this module failed to give.
 */

export async function linkTask(
  taskId: string,
  target: LinkTarget,
  targetId: string,
  relation: LinkRelation = 'about',
): Promise<{ error: string | null }> {
  const supabase = await createTodoClient();

  const { error } = await supabase.from('task_links').insert({
    task_id: taskId,
    relation,
    [TARGET_COLUMNS[target]]: targetId,
  });

  return { error: error ? describe(error.message) : null };
}

/**
 * The trigger's message names the real problem; a Postgres constraint name
 * does not. Both are surfaced as themselves rather than as "Something went
 * wrong", which is what sends someone looking in the wrong place.
 */
function describe(message: string): string {
  if (message.includes('must point at something')) return 'That is not yours to link to.';
  if (message.includes('task_links_about_key')) {
    return 'This task is already about something else.';
  }
  return message;
}

/**
 * What this task is about, replacing whatever it was about before.
 *
 * A task is about one thing -- `task_links_about_key` is a unique index on the
 * task -- so pointing at a second thing has to move the existing row rather
 * than add one. It is written as an UPDATE for a reason: delete-then-insert
 * would lose the link you already had when the insert is refused, and being
 * refused is the whole point of the ownership trigger. One statement either
 * takes or does not.
 *
 * A task with no anchor yet has no row to move, so that case inserts.
 */
export async function setTaskAbout(
  taskId: string,
  target: LinkTarget,
  targetId: string,
): Promise<{ error: string | null }> {
  const supabase = await createTodoClient();

  // Every target column cleared, then the one being set: a row moved from a
  // role to a company must stop naming the role, and the check constraint
  // insists on exactly one either way.
  const columns: Record<string, string | null> = {};
  for (const each of LINK_TARGETS) columns[TARGET_COLUMNS[each]] = null;
  columns[TARGET_COLUMNS[target]] = targetId;

  const { data, error } = await supabase
    .from('task_links')
    .update(columns)
    .eq('task_id', taskId)
    .eq('relation', 'about')
    .select('id');

  if (error) return { error: describe(error.message) };
  if ((data ?? []).length > 0) return { error: null };

  return linkTask(taskId, target, targetId);
}

/** Nothing in particular, and the task itself untouched. */
export async function clearTaskAbout(taskId: string): Promise<{ error: string | null }> {
  const supabase = await createTodoClient();

  const { error } = await supabase
    .from('task_links')
    .delete()
    .eq('task_id', taskId)
    .eq('relation', 'about');

  return { error: error?.message ?? null };
}

export async function unlinkTask(
  taskId: string,
  target: LinkTarget,
  targetId: string,
): Promise<{ error: string | null }> {
  const supabase = await createTodoClient();

  const { error } = await supabase
    .from('task_links')
    .delete()
    .eq('task_id', taskId)
    .eq(TARGET_COLUMNS[target], targetId);

  return { error: error?.message ?? null };
}
