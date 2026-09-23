import 'server-only';

import { assertSchemaExposed } from '@/lib/core/db/schema-errors';
import { NEWS_SCHEMA, type NewsSupabaseClient } from '@/lib/news/db/schema-name';
import { readStories } from '@/lib/news/issues/stories';

/**
 * Saving a story to read again (plan #869), into news.saved_stories
 * (supabase/migrations-news/0009_saved_stories.sql).
 *
 * A story counts as saved when a row for its issue and headline exists, which
 * is the table's unique key with the user. The rows are the session's own by
 * the table's policy, so the reads here filter by issue and nothing else.
 */

/**
 * The headlines saved from one newsletter, for the page to mark each story
 * Save or Saved. Headlines are compared as readStories trims them, which is
 * how they are stored.
 */
export async function loadSavedHeadlines(
  client: NewsSupabaseClient,
  issueId: string,
): Promise<Set<string>> {
  const { data, error } = await client
    .from('saved_stories')
    .select('headline')
    .eq('issue_id', issueId);
  assertSchemaExposed(error, NEWS_SCHEMA);
  if (error) throw new Error(`news: reading your saved stories failed (${error.message})`);
  return new Set(((data ?? []) as { headline: string }[]).map((row) => row.headline));
}

/**
 * Copy one story into the Saved list.
 *
 * The story is read again from the newsletter by its headline rather than
 * taken from the form, so what is saved is what the email said. The copy keeps
 * the sender's name (its address when it gave none) and when the newsletter
 * arrived, because the Saved list outlives the newsletter it came from.
 *
 * Returns false when there is no such newsletter or no story with that
 * headline in it. Saving a story already saved keeps its first row, and its
 * first saved_at. `userId` is the session's, written because the policy
 * checks it.
 */
export async function saveStory(
  client: NewsSupabaseClient,
  { userId, issueId, headline }: { userId: string; issueId: string; headline: string },
): Promise<boolean> {
  const { data: issue, error: issueError } = await client
    .from('issues')
    .select('sender_id, received_at, stories')
    .eq('id', issueId)
    .maybeSingle();
  assertSchemaExposed(issueError, NEWS_SCHEMA);
  if (issueError) throw new Error(`news: reading the newsletter failed (${issueError.message})`);
  if (!issue) return false;

  const row = issue as { sender_id: string; received_at: string; stories: unknown };
  const story = readStories(row.stories).find((s) => s.headline === headline.trim());
  if (!story) return false;

  const { data: sender, error: senderError } = await client
    .from('senders')
    .select('name, email')
    .eq('id', row.sender_id)
    .maybeSingle();
  assertSchemaExposed(senderError, NEWS_SCHEMA);
  if (senderError) throw new Error(`news: reading the sender failed (${senderError.message})`);
  const { name, email } = (sender ?? {}) as { name?: string | null; email?: string | null };
  const senderName = name?.trim() || email?.trim() || 'Unknown sender';

  const { error } = await client.from('saved_stories').upsert(
    {
      user_id: userId,
      issue_id: issueId,
      headline: story.headline,
      summary: story.summary,
      text: story.text ?? null,
      link: story.link ?? null,
      image: story.image ?? null,
      sender_name: senderName,
      received_at: row.received_at,
    },
    { onConflict: 'user_id,issue_id,headline', ignoreDuplicates: true },
  );
  assertSchemaExposed(error, NEWS_SCHEMA);
  if (error) throw new Error(`news: saving the story failed (${error.message})`);
  return true;
}

/** Take a story off the Saved list. Removing one that is not saved does nothing. */
export async function removeSavedStory(
  client: NewsSupabaseClient,
  { issueId, headline }: { issueId: string; headline: string },
): Promise<void> {
  const { error } = await client
    .from('saved_stories')
    .delete()
    .eq('issue_id', issueId)
    .eq('headline', headline.trim());
  assertSchemaExposed(error, NEWS_SCHEMA);
  if (error) throw new Error(`news: removing the saved story failed (${error.message})`);
}
