import 'server-only';

import { assertSchemaExposed } from '@/lib/core/db/schema-errors';
import { TODO_SCHEMA, type TodoSupabaseClient } from '@/lib/todo/db/schema-name';
import { linkTask } from '@/lib/todo/links/write';
import { createTask, setTaskStatus, taskInput } from '@/lib/todo/tasks/write';

/**
 * A todo made from a newsletter story (plan #1369).
 *
 * The task is titled with the headline and has no body: the story's text
 * stays in news.saved_stories, and the task points at it through
 * task_links.saved_story_id, so the agenda labels it with the newsletter and
 * the headline and opens the story. The caller saves the story first and
 * passes the saved row's id.
 *
 * A story that already has an open task returns that task rather than adding
 * a second. A task that has been done or dropped does not count, so a story
 * can be made a todo again once the first is finished. That is also why no
 * unique index backs the rule, as one does for readings
 * (migrations-news/0018): an index on saved_story_id would refuse the second
 * todo after the first was done. Two presses landing together could make
 * two; the button says Added at once, so a second press is unlikely.
 */

/** The task's title is the headline, cut to what taskInput allows. */
const TITLE_MAX = 500;

export type StoryTodo = { taskId: string; created: boolean };

/**
 * The open task each saved story has, keyed by the story's id. Stories with
 * none are absent. Two reads whatever the number of stories: the links, then
 * which of their tasks are open. Where a story has more than one open task,
 * the oldest is the one returned.
 */
export async function findOpenStoryTasks(
  supabase: TodoSupabaseClient,
  savedStoryIds: readonly string[],
): Promise<Map<string, string>> {
  const found = new Map<string, string>();
  const wanted = [...new Set(savedStoryIds)];
  if (wanted.length === 0) return found;

  const { data: links, error: linkError } = await supabase
    .from('task_links')
    .select('task_id, saved_story_id')
    .eq('relation', 'about')
    .in('saved_story_id', wanted);
  assertSchemaExposed(linkError, TODO_SCHEMA);
  if (linkError) throw new Error(`Looking for that story in Todo failed: ${linkError.message}`);

  const linkRows = (links ?? []) as { task_id: string; saved_story_id: string }[];
  if (linkRows.length === 0) return found;

  const { data: tasks, error: taskError } = await supabase
    .from('tasks')
    .select('id')
    .in('id', [...new Set(linkRows.map((row) => row.task_id))])
    .eq('status', 'open')
    .order('created_at', { ascending: true });
  assertSchemaExposed(taskError, TODO_SCHEMA);
  if (taskError) throw new Error(`Looking for that story in Todo failed: ${taskError.message}`);

  const storyOf = new Map(linkRows.map((row) => [row.task_id, row.saved_story_id]));
  for (const { id } of (tasks ?? []) as { id: string }[]) {
    const story = storyOf.get(id);
    if (story && !found.has(story)) found.set(story, id);
  }
  return found;
}

/**
 * Make the todo, or return the open one the story already has.
 *
 * The task and its link are two writes, in the order addLinkedTask makes
 * them, and a link the database refuses drops the task rather than leaving
 * one that does not open the story.
 */
export async function makeStoryTask(
  supabase: TodoSupabaseClient,
  userId: string,
  story: { id: string; headline: string },
  timezone: string,
): Promise<StoryTodo> {
  const existing = (await findOpenStoryTasks(supabase, [story.id])).get(story.id);
  if (existing) return { taskId: existing, created: false };

  const input = taskInput.parse({
    title: story.headline.trim().slice(0, TITLE_MAX),
    body: '',
    dueOn: '',
    dueTime: '',
    pinned: false,
  });

  const { id, error } = await createTask(userId, input, timezone);
  if (error || !id) throw new Error(`Making that story a todo failed: ${error ?? 'no row'}`);

  const link = await linkTask(id, 'story', story.id);
  if (link.error) {
    await setTaskStatus(userId, id, 'dropped');
    throw new Error(`Making that story a todo failed: ${link.error}`);
  }
  return { taskId: id, created: true };
}
