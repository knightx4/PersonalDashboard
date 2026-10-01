import 'server-only';

import { assertSchemaExposed } from '@/lib/core/db/schema-errors';
import { LEARN_SCHEMA, type LearnSupabaseClient } from '@/lib/learn/db/schema-name';
import { createTrack, upsertSource } from '@/lib/learn/tracks/save';

/** The reading list Send to Learn puts a newsletter story on. */
export const FROM_NEWS = 'From News';

/** The saved copy of a newsletter story, as Send to Learn needs it. */
export type SentStory = {
  /** news.saved_stories.id, which the reading points at. */
  id: string;
  headline: string;
  link: string | null;
  senderName: string;
};

export type QueuedStory = { trackId: string; readingId: string; created: boolean };

/** readings.title and the sources' title columns refuse more than this. */
const TITLE_MAX = 500;

/**
 * Put a saved newsletter story on the reading queue (plan #1368).
 *
 * The reading points at the saved story through news_story_id and copies none
 * of its text: the story stays in News and the reading opens it there. The
 * caller saves the story first and passes the saved row.
 *
 * A story already on the queue returns the reading already there, wherever it
 * has been moved since. Otherwise the reading goes on the From News list,
 * found by its title and made the first time, the way saveFeedSection finds
 * "Saved from Learn now". Renaming the list means the next story starts a new
 * one, which is the same trade that list makes.
 *
 * When the story links to its article over https, the article is the source,
 * deduped on its URL like any other, and the reading opens it. Access is
 * written unknown: the newsletter says nothing about a paywall.
 */
export async function queueNewsStory(
  supabase: LearnSupabaseClient,
  userId: string,
  story: SentStory,
): Promise<QueuedStory> {
  const existing = await findQueued(supabase, story.id);
  if (existing) return { ...existing, created: false };

  const { data: found, error: findError } = await supabase
    .from('tracks')
    .select('id')
    .eq('title', FROM_NEWS)
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle();
  assertSchemaExposed(findError, LEARN_SCHEMA);
  if (findError) throw new Error(`Finding your From News list failed: ${findError.message}`);

  const trackId =
    (found as { id: string } | null)?.id ??
    (await createTrack(supabase, userId, {
      title: FROM_NEWS,
      question: 'Stories you sent from your newsletters to read properly.',
    }));

  const title = story.headline.trim().slice(0, TITLE_MAX);
  const link = story.link && /^https:\/\//.test(story.link) ? story.link : null;
  const basis = `A story in ${story.senderName}, sent from News.`;

  const sourceId = link
    ? await upsertSource(supabase, userId, {
        title,
        author: null,
        kind: 'article',
        year: null,
        canonical_url: link,
        access: 'unknown',
        price_cents: null,
        page_count: null,
        locator_kind: 'whole',
        locator_label: null,
        page_from: null,
        page_to: null,
        locator_basis: basis,
        locator_verified: false,
        why: null,
        not_found: false,
      })
    : null;

  const { data: last } = await supabase
    .from('readings')
    .select('position')
    .eq('track_id', trackId)
    .order('position', { ascending: false })
    .limit(1)
    .maybeSingle();
  const position = ((last as { position: number } | null)?.position ?? 0) + 10;

  const { data, error } = await supabase
    .from('readings')
    .insert({
      user_id: userId,
      track_id: trackId,
      source_id: sourceId,
      title,
      position,
      news_story_id: story.id,
      locator_kind: 'whole',
      open_url: link,
      locator_confidence: 'unverified',
      locator_basis: basis,
    })
    .select('id')
    .single();
  assertSchemaExposed(error, LEARN_SCHEMA);

  // Two presses that land together both find nothing above; the unique index
  // (migrations-news/0018) lets one in and turns the other away. The one
  // turned away returns the reading the first wrote.
  if (error?.code === '23505') {
    const raced = await findQueued(supabase, story.id);
    if (raced) return { ...raced, created: false };
  }
  if (error || !data) {
    throw new Error(`Sending that story to Learn failed: ${error?.message ?? 'no row'}`);
  }
  return { trackId, readingId: (data as { id: string }).id, created: true };
}

async function findQueued(
  supabase: LearnSupabaseClient,
  storyId: string,
): Promise<{ trackId: string; readingId: string } | null> {
  const { data, error } = await supabase
    .from('readings')
    .select('id, track_id')
    .eq('news_story_id', storyId)
    .maybeSingle();
  assertSchemaExposed(error, LEARN_SCHEMA);
  if (error) throw new Error(`Looking for that story in Learn failed: ${error.message}`);
  if (!data) return null;
  const row = data as { id: string; track_id: string };
  return { trackId: row.track_id, readingId: row.id };
}
