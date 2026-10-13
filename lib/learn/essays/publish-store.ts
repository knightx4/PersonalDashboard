import type { LearnSupabaseClient } from '@/lib/learn/db/schema-name';
import { linkKey, linksToEssay, unlinkEssay, type EssaySnapshot } from './publish';

/**
 * What Publish and Unpublish read and write on `learn.essays` (plan
 * #1863.11), through the person's own session. The site never comes here: it
 * reads the snapshot through the two functions in learn migration 0110.
 */

export type PublishRow = {
  path: string;
  slug: string | null;
  finishedAt: string | null;
  publishedAt: string | null;
  firstPublishedAt: string | null;
};

export async function loadPublishRow(supabase: LearnSupabaseClient, id: string): Promise<PublishRow | null> {
  const { data, error } = await supabase
    .from('essays')
    .select('path, slug, finished_at, published_at, first_published_at')
    .eq('id', id)
    .maybeSingle();
  if (error) throw new Error(`Could not read the essay: ${error.message}`);
  if (!data) return null;
  const row = data as {
    path: string;
    slug: string | null;
    finished_at: string | null;
    published_at: string | null;
    first_published_at: string | null;
  };
  return {
    path: row.path,
    slug: row.slug,
    finishedAt: row.finished_at,
    publishedAt: row.published_at,
    firstPublishedAt: row.first_published_at,
  };
}

/**
 * The person's published essays as a wikilink names them, mapped to their
 * slugs, with the essay being published (which is about to be one) added.
 */
export async function publishedLinkMap(
  supabase: LearnSupabaseClient,
  self: { path: string; slug: string },
): Promise<Map<string, string>> {
  const { data, error } = await supabase
    .from('essays')
    .select('path, slug')
    .not('published_at', 'is', null)
    .not('slug', 'is', null);
  if (error) throw new Error(`Could not read your published essays: ${error.message}`);
  const map = new Map<string, string>();
  for (const row of (data ?? []) as { path: string; slug: string }[]) map.set(linkKey(row.path), row.slug);
  map.set(linkKey(self.path), self.slug);
  return map;
}

/** Write the snapshot. `firstAt` is kept from an earlier publish. */
export async function savePublished(
  supabase: LearnSupabaseClient,
  id: string,
  snapshot: EssaySnapshot,
  at: string,
  firstAt: string,
): Promise<void> {
  const { error } = await supabase
    .from('essays')
    .update({
      published_body: snapshot.body,
      published_title: snapshot.title,
      published_description: snapshot.description,
      published_stage: snapshot.stage,
      published_confidence: snapshot.confidence,
      published_tags: snapshot.tags,
      published_at: at,
      first_published_at: firstAt,
    })
    .eq('id', id);
  if (error) throw new Error(`Could not publish the essay: ${error.message}`);
}

/** Clear the snapshot; the first-published date stays for a later publish. */
export async function clearPublished(supabase: LearnSupabaseClient, id: string): Promise<void> {
  const { error } = await supabase
    .from('essays')
    .update({
      published_body: null,
      published_title: null,
      published_description: null,
      published_stage: null,
      published_confidence: null,
      published_tags: [],
      published_at: null,
    })
    .eq('id', id);
  if (error) throw new Error(`Could not unpublish the essay: ${error.message}`);
}

/**
 * Take the links to the essay at `slug` out of every other published
 * snapshot, so none points at an essay the site no longer has (R4). Returns
 * how many snapshots changed.
 */
export async function unlinkFromPublished(supabase: LearnSupabaseClient, slug: string): Promise<number> {
  const { data, error } = await supabase
    .from('essays')
    .select('id, published_body')
    .not('published_at', 'is', null)
    .not('published_body', 'is', null);
  if (error) throw new Error(`Could not read your published essays: ${error.message}`);
  let changed = 0;
  for (const row of (data ?? []) as { id: string; published_body: string }[]) {
    if (!linksToEssay(row.published_body, slug)) continue;
    const { error: writeError } = await supabase
      .from('essays')
      .update({ published_body: unlinkEssay(row.published_body, slug) })
      .eq('id', row.id);
    if (writeError) throw new Error(`Could not update a published essay: ${writeError.message}`);
    changed += 1;
  }
  return changed;
}
