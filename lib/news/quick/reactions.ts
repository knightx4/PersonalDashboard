import 'server-only';

import { assertSchemaExposed } from '@/lib/core/db/schema-errors';
import { NEWS_SCHEMA, type NewsSupabaseClient } from '@/lib/news/db/schema-name';
import { readStories } from '@/lib/news/issues/stories';

/**
 * Thumbs up and thumbs down on a Quick read card, in news.story_reactions
 * (supabase/migrations-news/0015_story_reactions.sql).
 *
 * For now a reaction is only recorded. Nothing ranks or hides stories by it
 * yet; lib/news/quick/rank.ts can read it once there is enough to learn from.
 * The rows are the session's own by the table's policy, so the reads here
 * filter by issue and nothing else.
 */

export type Reaction = 'up' | 'down';

/** Where a story's reaction is kept in the map loadReactions returns. */
export function reactionKey(issueId: string, storyIndex: number): string {
  return `${issueId}:${storyIndex}`;
}

/** The reactions on the stories of these newsletters, keyed by reactionKey. */
export async function loadReactions(
  client: NewsSupabaseClient,
  issueIds: readonly string[],
): Promise<Map<string, Reaction>> {
  if (!issueIds.length) return new Map();
  const { data, error } = await client
    .from('story_reactions')
    .select('issue_id, story_index, reaction')
    .in('issue_id', [...issueIds]);
  assertSchemaExposed(error, NEWS_SCHEMA);
  if (error) throw new Error(`news: reading your thumbs up and down failed (${error.message})`);
  return new Map(
    ((data ?? []) as { issue_id: string; story_index: number; reaction: Reaction }[]).map(
      (row) => [reactionKey(row.issue_id, row.story_index), row.reaction],
    ),
  );
}

/**
 * Record a thumbs up or down on one story, or clear it with null.
 *
 * The headline and topic are read again from the newsletter rather than taken
 * from the form, and copied onto the row, because re-summarising a newsletter
 * rewrites its stories array and story_index would then name another story.
 * A newsletter that is one essay has no story, so its subject is the
 * headline.
 *
 * Returns false when there is no such newsletter. `userId` is the session's,
 * written because the policy checks it.
 */
export async function setReaction(
  client: NewsSupabaseClient,
  {
    userId,
    issueId,
    storyIndex,
    reaction,
  }: { userId: string; issueId: string; storyIndex: number; reaction: Reaction | null },
): Promise<boolean> {
  if (reaction === null) {
    const { error } = await client
      .from('story_reactions')
      .delete()
      .eq('issue_id', issueId)
      .eq('story_index', storyIndex);
    assertSchemaExposed(error, NEWS_SCHEMA);
    if (error) throw new Error(`news: clearing the reaction failed (${error.message})`);
    return true;
  }

  const { data: issue, error: issueError } = await client
    .from('issues')
    .select('sender_id, subject, stories')
    .eq('id', issueId)
    .maybeSingle();
  assertSchemaExposed(issueError, NEWS_SCHEMA);
  if (issueError) throw new Error(`news: reading the newsletter failed (${issueError.message})`);
  if (!issue) return false;

  const row = issue as { sender_id: string | null; subject: string | null; stories: unknown };
  const entry = Array.isArray(row.stories) ? row.stories[storyIndex] : undefined;
  const [story] = entry === undefined ? [] : readStories([entry]);
  const headline = story?.headline ?? (row.subject?.trim() || 'No subject');

  const { error } = await client.from('story_reactions').upsert(
    {
      user_id: userId,
      issue_id: issueId,
      story_index: storyIndex,
      reaction,
      headline,
      topic: story?.topic ?? null,
      sender_id: row.sender_id,
      reacted_at: new Date().toISOString(),
    },
    { onConflict: 'user_id,issue_id,story_index' },
  );
  assertSchemaExposed(error, NEWS_SCHEMA);
  if (error) throw new Error(`news: saving the reaction failed (${error.message})`);
  return true;
}
