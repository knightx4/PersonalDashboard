import 'server-only';

import { createTodoClient } from '@/lib/todo/auth/server';
import { TARGET_COLUMNS, type LinkRelation, type LinkTarget } from '@/lib/todo/links/model';

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

  if (!error) return { error: null };

  // The trigger's message names the real problem; a Postgres constraint name
  // does not. Both are surfaced as themselves rather than as "Something went
  // wrong", which is what sends someone looking in the wrong place.
  if (error.message.includes('must point at something')) {
    return { error: 'That is not yours to link to.' };
  }
  if (error.message.includes('task_links_about_key')) {
    return { error: 'This task is already about something else.' };
  }
  return { error: error.message };
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
