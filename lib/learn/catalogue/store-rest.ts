import { WIKIPEDIA_PROVIDER_SLUG, type WikipediaArticle } from '@/lib/learn/providers/wikipedia';
import type { LearnSupabaseClient } from '@/lib/learn/db/schema-name';
import type { CatalogueSegmentInput, StoredArticle } from './store';

/**
 * Writing a fetched article into the catalogue through the service-role
 * Supabase client.
 *
 * `store.ts` does the same over a `postgres` connection. The background passes
 * reach Supabase over HTTPS with the service-role key instead, which was the
 * only way until the deployed app could open that connection (it falls back to
 * the Supabase integration's POSTGRES_URL; see `databaseUrl` in lib/env.ts).
 * The Learn now pass (plan #806) writes through this.
 *
 * The rules are the ones `store.ts` keeps. The item is upserted on
 * `(provider_id, external_id)` and each section on `(item_id, ordinal)`, so a
 * re-sweep updates rows rather than adding them. Sections past the article's
 * new length are deleted. A section whose text changed loses its embedding,
 * because a vector for text that is no longer there is worse than none.
 * PostgREST cannot express that `case when` in an upsert, so the stored text
 * is read first and only the sections that changed are written with their
 * embedding cleared.
 *
 * It is four requests, not one transaction. A failure part way leaves an item
 * with some of its sections updated, which the next sweep of the same article
 * finishes; nothing reads a half-written article as whole, because every card
 * points at one section.
 */

export type StoredArticleWithSegments = StoredArticle & {
  /** Every section now stored for the item, by ordinal. */
  segments: { id: string; ordinal: number }[];
};

export async function storeArticleOverRest(
  learn: LearnSupabaseClient,
  article: WikipediaArticle,
): Promise<StoredArticleWithSegments> {
  const provider = await learn
    .from('catalogue_providers')
    .update({ enabled: true, last_swept_at: new Date().toISOString() })
    .eq('slug', WIKIPEDIA_PROVIDER_SLUG)
    .select('id')
    .maybeSingle();
  if (provider.error) throw new Error(`Marking Wikipedia swept failed: ${provider.error.message}`);
  if (!provider.data) {
    throw new Error(
      `No catalogue provider called ${WIKIPEDIA_PROVIDER_SLUG}. Apply supabase/migrations-learn/0022_catalogue.sql.`,
    );
  }
  const providerId = (provider.data as { id: string }).id;

  const item = await learn
    .from('catalogue_items')
    .upsert(
      {
        provider_id: providerId,
        external_id: article.externalId,
        title: article.title,
        kind: 'article',
        canonical_url: article.canonicalUrl,
        length_chars: article.lengthChars,
        duration_seconds: null,
        published_at: null,
        image_url: article.image?.url ?? null,
        image_file: article.image?.file ?? null,
        image_checked_at: new Date().toISOString(),
      },
      { onConflict: 'provider_id,external_id' },
    )
    .select('id')
    .single();
  if (item.error) throw new Error(`Storing ${article.title} failed: ${item.error.message}`);
  const itemId = (item.data as { id: string }).id;

  const rows = article.sections.map((section) => ({
    ordinal: section.ordinal,
    tStartSeconds: null,
    tEndSeconds: null,
    sectionAnchor: section.anchor,
    heading: section.heading,
    text: section.text,
  }));
  const { removed, segments } = await writeSegmentsOverRest(learn, itemId, rows, article.title);

  return {
    itemId,
    written: article.sections.length,
    removed,
    segments,
  };
}

/**
 * Replace one item's segments with these, keeping the embedding of every
 * segment whose text did not change.
 *
 * The article writer above and the transcript runner in lib/learn/youtube
 * both come through here. Segments are upserted on `(item_id, ordinal)`, the
 * ones past the new count are deleted, and a segment whose text changed loses
 * its vector so the embedding pass picks it up again.
 */
export async function writeSegmentsOverRest(
  learn: LearnSupabaseClient,
  itemId: string,
  input: CatalogueSegmentInput[],
  label: string,
): Promise<{ removed: number; segments: { id: string; ordinal: number }[] }> {
  const existing = await learn
    .from('catalogue_segments')
    .select('ordinal, text')
    .eq('item_id', itemId);
  if (existing.error) throw new Error(`Reading ${label}'s segments failed: ${existing.error.message}`);
  const storedText = new Map(
    ((existing.data ?? []) as { ordinal: number; text: string }[]).map((row) => [row.ordinal, row.text]),
  );

  const rows = input.map((segment) => ({
    item_id: itemId,
    ordinal: segment.ordinal,
    t_start_seconds: segment.tStartSeconds,
    t_end_seconds: segment.tEndSeconds,
    section_anchor: segment.sectionAnchor,
    heading: segment.heading,
    text: segment.text,
  }));
  const changed = rows
    .filter((row) => storedText.get(row.ordinal) !== row.text)
    .map((row) => ({ ...row, embedding: null, embedding_model: null, embedded_at: null }));
  const unchanged = rows.filter((row) => storedText.get(row.ordinal) === row.text);

  for (const batch of [changed, unchanged]) {
    if (batch.length === 0) continue;
    const { error } = await learn
      .from('catalogue_segments')
      .upsert(batch, { onConflict: 'item_id,ordinal' });
    if (error) throw new Error(`Storing ${label}'s segments failed: ${error.message}`);
  }

  const removed = await learn
    .from('catalogue_segments')
    .delete()
    .eq('item_id', itemId)
    .gte('ordinal', input.length)
    .select('id');
  if (removed.error) throw new Error(`Trimming ${label}'s segments failed: ${removed.error.message}`);

  const segments = await learn
    .from('catalogue_segments')
    .select('id, ordinal')
    .eq('item_id', itemId)
    .order('ordinal');
  if (segments.error) throw new Error(`Reading ${label}'s segments failed: ${segments.error.message}`);

  return {
    removed: (removed.data ?? []).length,
    segments: (segments.data ?? []) as { id: string; ordinal: number }[],
  };
}
