import 'server-only';

import { assertSchemaExposed } from '@/lib/core/db/schema-errors';
import { createLearnClient } from '@/lib/learn/auth/server';
import { findQueuedStories } from '@/lib/learn/tracks/news';
import { NEWS_SCHEMA, type NewsSupabaseClient } from '@/lib/news/db/schema-name';
import { createTodoClient } from '@/lib/todo/auth/server';
import { findOpenStoryTasks } from '@/lib/todo/links/story';

/** Where one story went: its reading in Learn and its open todo, each null when none. */
export type StorySent = { readingId: string | null; taskId: string | null };

/**
 * Where each story has already been sent (plan #1370): the reading it is on in
 * Learn and the open todo it has, so Send to Learn and Make a todo come back
 * after a reload saying where the story went.
 *
 * Both are keyed by the saved copy, since that is what a reading and a task
 * point at. A story that was sent and then unsaved keeps its row, so the reads
 * here include unsaved rows.
 *
 * Showing the state is a courtesy: a Learn or Todo read that fails leaves the
 * buttons unsent rather than failing the News page, and pressing one then
 * returns what is already there.
 */
export async function loadSentBySaved(
  savedIds: readonly string[],
): Promise<Map<string, StorySent>> {
  const sent = new Map<string, StorySent>();
  if (savedIds.length === 0) return sent;

  const [readings, tasks] = await Promise.all([
    createLearnClient()
      .then((learn) => findQueuedStories(learn, savedIds))
      .catch(() => new Map<string, string>()),
    createTodoClient()
      .then((todo) => findOpenStoryTasks(todo, savedIds))
      .catch(() => new Map<string, string>()),
  ]);
  for (const id of savedIds) {
    const readingId = readings.get(id) ?? null;
    const taskId = tasks.get(id) ?? null;
    if (readingId || taskId) sent.set(id, { readingId, taskId });
  }
  return sent;
}

/** The key loadSentInIssues returns: a story by its newsletter and headline. */
export function sentKey(issueId: string, headline: string): string {
  return `${issueId}\n${headline.trim()}`;
}

/**
 * Where the stories of some newsletters have been sent, keyed by sentKey.
 * One read of the saved rows for those newsletters, then loadSentBySaved.
 */
export async function loadSentInIssues(
  client: NewsSupabaseClient,
  issueIds: readonly string[],
): Promise<Map<string, StorySent>> {
  const found = new Map<string, StorySent>();
  const wanted = [...new Set(issueIds)];
  if (wanted.length === 0) return found;

  const { data, error } = await client
    .from('saved_stories')
    .select('id, issue_id, headline')
    .in('issue_id', wanted);
  assertSchemaExposed(error, NEWS_SCHEMA);
  if (error) return found;

  const rows = (data ?? []) as { id: string; issue_id: string; headline: string }[];
  const sent = await loadSentBySaved(rows.map((row) => row.id));
  for (const row of rows) {
    const where = sent.get(row.id);
    if (where) found.set(sentKey(row.issue_id, row.headline), where);
  }
  return found;
}
