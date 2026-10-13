import 'server-only';

import { assertSchemaExposed } from '@/lib/core/db/schema-errors';
import { safeFetch } from '@/lib/jobs/ats/ssrf';
import { LEARN_SCHEMA, type LearnSupabaseClient } from '@/lib/learn/db/schema-name';
import { createTrack, upsertSource } from '@/lib/learn/tracks/save';
import { readLinkMeta, titleFromUrl, type LinkMeta } from './link-meta';

/** The reading list a saved link goes on. */
export const SAVED_LINKS = 'Saved links';

export type SavedLink = { trackId: string; readingId: string; title: string; created: boolean };

/**
 * The page's title and author, read from the page. A page that cannot be
 * fetched (a paywall that refuses robots, a timeout) still saves, titled from
 * its address, because losing the link is worse than a plain title.
 */
export async function fetchLinkMeta(url: string): Promise<LinkMeta> {
  try {
    const page = await safeFetch(url, {
      headers: { 'User-Agent': 'Dash/1.0 (+reading list; one request per saved link)' },
    });
    if (page.status >= 400 || !/html/i.test(page.contentType)) return { title: titleFromUrl(url), author: null };
    return readLinkMeta(page.body, url);
  } catch {
    return { title: titleFromUrl(url), author: null };
  }
}

/**
 * Put a link on the reading queue in one step (quick capture), the way Send
 * to Learn puts a newsletter story there.
 *
 * A link already on any list returns the reading already there rather than a
 * second copy. Otherwise it goes on the "Saved links" list, found by its title
 * and made the first time. The page is the source, deduped on its URL, and the
 * reading opens it.
 */
export async function saveLink(
  supabase: LearnSupabaseClient,
  userId: string,
  input: { url: string; meta: LinkMeta },
): Promise<SavedLink> {
  const existing = await findSaved(supabase, input.url);
  if (existing) return { ...existing, created: false };

  const { data: found, error: findError } = await supabase
    .from('tracks')
    .select('id')
    .eq('title', SAVED_LINKS)
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle();
  assertSchemaExposed(findError, LEARN_SCHEMA);
  if (findError) throw new Error(`Finding your Saved links list failed: ${findError.message}`);

  const trackId =
    (found as { id: string } | null)?.id ??
    (await createTrack(supabase, userId, {
      title: SAVED_LINKS,
      question: 'Links you saved to read later.',
    }));

  const { title, author } = input.meta;
  const basis = 'A link you saved.';
  const sourceId = await upsertSource(supabase, userId, {
    title,
    author,
    kind: 'article',
    year: null,
    canonical_url: input.url,
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
  });

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
      locator_kind: 'whole',
      open_url: input.url,
      locator_confidence: 'unverified',
      locator_basis: basis,
    })
    .select('id')
    .single();
  assertSchemaExposed(error, LEARN_SCHEMA);
  if (error || !data) throw new Error(`Saving that link failed: ${error?.message ?? 'no row'}`);
  return { trackId, readingId: (data as { id: string }).id, title, created: true };
}

/** The reading that already opens this URL, on any list. */
async function findSaved(
  supabase: LearnSupabaseClient,
  url: string,
): Promise<{ trackId: string; readingId: string; title: string } | null> {
  const { data, error } = await supabase
    .from('readings')
    .select('id, track_id, title')
    .eq('open_url', url)
    .neq('status', 'abandoned')
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle();
  assertSchemaExposed(error, LEARN_SCHEMA);
  if (error) throw new Error(`Looking for that link in Learn failed: ${error.message}`);
  if (!data) return null;
  const row = data as { id: string; track_id: string; title: string | null };
  return { trackId: row.track_id, readingId: row.id, title: row.title ?? url };
}
