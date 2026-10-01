import 'server-only';

import { assertSchemaExposed } from '@/lib/core/db/schema-errors';
import { NEWS_SCHEMA, type NewsSupabaseClient } from '@/lib/news/db/schema-name';
import { readStories } from '@/lib/news/issues/stories';
import { savedStoryAnchor } from '@/lib/news/saved/anchor';

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
    .eq('issue_id', issueId)
    .is('unsaved_at', null);
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

  // A story unsaved while a reading or a task pointed at it kept its row, so
  // the upsert above left it alone. Saving it again puts it back on the list
  // as a fresh save (plan #1367).
  const { error: restoreError } = await client
    .from('saved_stories')
    .update({ unsaved_at: null, saved_at: new Date().toISOString() })
    .eq('issue_id', issueId)
    .eq('headline', story.headline)
    .not('unsaved_at', 'is', null);
  assertSchemaExposed(restoreError, NEWS_SCHEMA);
  if (restoreError) throw new Error(`news: saving the story failed (${restoreError.message})`);
  return true;
}

/**
 * Take a story off the Saved list. Removing one that is not saved does nothing.
 *
 * news.unsave_story (migrations-goals/0065) deletes the row, or, when a
 * reading in Learn or a task in Todo points at it, keeps it with unsaved_at
 * set so the Saved tab hides it and the reading or task still opens it
 * (plan #1367).
 */
export async function removeSavedStory(
  client: NewsSupabaseClient,
  { issueId, headline }: { issueId: string; headline: string },
): Promise<void> {
  const { data, error } = await client
    .from('saved_stories')
    .select('id')
    .eq('issue_id', issueId)
    .eq('headline', headline.trim())
    .maybeSingle();
  assertSchemaExposed(error, NEWS_SCHEMA);
  if (error) throw new Error(`news: removing the saved story failed (${error.message})`);
  if (!data) return;
  await unsaveStory(client, (data as { id: string }).id);
}

/** The one call both ways of unsaving make; returns the story's issue. */
async function unsaveStory(client: NewsSupabaseClient, id: string): Promise<string | null> {
  const { data, error } = await client.rpc('unsave_story', { story_id: id });
  assertSchemaExposed(error, NEWS_SCHEMA);
  if (error) throw new Error(`news: removing the saved story failed (${error.message})`);
  return (data as string | null) ?? null;
}

/** One story on the Saved list, as the Saved tab draws it (plan #870). */
export type SavedStory = {
  id: string;
  /** Null once the newsletter it came from has been deleted; the copy stays. */
  issueId: string | null;
  headline: string;
  summary: string;
  text: string | null;
  link: string | null;
  image: string | null;
  senderName: string;
  receivedAt: string;
  savedAt: string;
};

/**
 * How many saved stories the tab reads. A cap on one page rather than on what
 * is kept, the same as the newsletter list's.
 */
const SAVED_PAGE = 500;

/**
 * Everything on the Saved list, the most recently saved first. A story
 * unsaved while something pointed at it is kept but not listed (plan #1367).
 */
export async function loadSavedStories(client: NewsSupabaseClient): Promise<SavedStory[]> {
  const { data, error } = await client
    .from('saved_stories')
    .select('id, issue_id, headline, summary, text, link, image, sender_name, received_at, saved_at')
    .is('unsaved_at', null)
    .order('saved_at', { ascending: false })
    .limit(SAVED_PAGE);
  assertSchemaExposed(error, NEWS_SCHEMA);
  if (error) throw new Error(`news: reading your saved stories failed (${error.message})`);
  return (data ?? []).map((row) => ({
    id: row.id as string,
    issueId: (row.issue_id as string | null) ?? null,
    headline: row.headline as string,
    summary: row.summary as string,
    text: (row.text as string | null) ?? null,
    link: (row.link as string | null) ?? null,
    image: (row.image as string | null) ?? null,
    senderName: row.sender_name as string,
    receivedAt: row.received_at as string,
    savedAt: row.saved_at as string,
  }));
}

/**
 * Take one row off the Saved list by its id, which is the only key a story
 * whose newsletter was deleted still has. Returns the issue it came from, so
 * the caller can refresh that page's Save button, or null when the issue is
 * gone or the row was not there.
 */
export async function removeSavedStoryById(
  client: NewsSupabaseClient,
  id: string,
): Promise<{ issueId: string | null }> {
  return { issueId: await unsaveStory(client, id) };
}

/** The saved copy of a story, as Send to Learn hands it on (plan #1368). */
export type SavedStoryRef = {
  id: string;
  issueId: string | null;
  headline: string;
  link: string | null;
  senderName: string;
};

const REF_COLUMNS = 'id, issue_id, headline, link, sender_name';

function toRef(row: Record<string, unknown>): SavedStoryRef {
  return {
    id: row.id as string,
    issueId: (row.issue_id as string | null) ?? null,
    headline: row.headline as string,
    link: (row.link as string | null) ?? null,
    senderName: row.sender_name as string,
  };
}

/**
 * The saved row for a story in a newsletter, read after saveStory wrote it.
 * Null when there is none. The headline is compared trimmed, as it is stored.
 */
export async function findSavedStory(
  client: NewsSupabaseClient,
  { issueId, headline }: { issueId: string; headline: string },
): Promise<SavedStoryRef | null> {
  const { data, error } = await client
    .from('saved_stories')
    .select(REF_COLUMNS)
    .eq('issue_id', issueId)
    .eq('headline', headline.trim())
    .maybeSingle();
  assertSchemaExposed(error, NEWS_SCHEMA);
  if (error) throw new Error(`news: reading the saved story failed (${error.message})`);
  return data ? toRef(data as Record<string, unknown>) : null;
}

/**
 * One saved row by its id, the only key a story whose newsletter was deleted
 * still has. Sending it on also puts it back on Saved if it had been unsaved,
 * which is what saveStory does for a story read from its newsletter.
 */
export async function resaveStoryById(
  client: NewsSupabaseClient,
  id: string,
): Promise<SavedStoryRef | null> {
  const { data, error } = await client
    .from('saved_stories')
    .select(REF_COLUMNS)
    .eq('id', id)
    .maybeSingle();
  assertSchemaExposed(error, NEWS_SCHEMA);
  if (error) throw new Error(`news: reading the saved story failed (${error.message})`);
  if (!data) return null;

  const { error: restoreError } = await client
    .from('saved_stories')
    .update({ unsaved_at: null, saved_at: new Date().toISOString() })
    .eq('id', id)
    .not('unsaved_at', 'is', null);
  assertSchemaExposed(restoreError, NEWS_SCHEMA);
  if (restoreError) throw new Error(`news: saving the story failed (${restoreError.message})`);
  return toRef(data as Record<string, unknown>);
}

/**
 * Where a reading or a todo sent from News came from, for Learn and Todo to
 * say so (plans #1368, #1369): the newsletter's name, the headline, and where
 * the story can be opened. That is its row on
 * the Saved tab while it is saved, its newsletter once it has been unsaved, and
 * nowhere when the newsletter is gone too.
 */
export type StoryOrigin = { senderName: string; headline: string; href: string | null };

export async function loadStoryOrigins(
  client: NewsSupabaseClient,
  ids: readonly string[],
): Promise<Map<string, StoryOrigin>> {
  const origins = new Map<string, StoryOrigin>();
  const wanted = [...new Set(ids)];
  if (wanted.length === 0) return origins;

  const { data, error } = await client
    .from('saved_stories')
    .select('id, issue_id, sender_name, headline, unsaved_at')
    .in('id', wanted);
  assertSchemaExposed(error, NEWS_SCHEMA);
  if (error) throw new Error(`news: reading where those stories came from failed (${error.message})`);

  for (const row of (data ?? []) as {
    id: string;
    issue_id: string | null;
    sender_name: string;
    headline: string;
    unsaved_at: string | null;
  }[]) {
    const href = !row.unsaved_at
      ? `/news/saved#${savedStoryAnchor(row.id)}`
      : row.issue_id
        ? `/news/i/${row.issue_id}`
        : null;
    origins.set(row.id, { senderName: row.sender_name, headline: row.headline, href });
  }
  return origins;
}
