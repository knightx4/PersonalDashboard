import { WIKIPEDIA_PROVIDER_SLUG, type WikipediaArticle } from '@/lib/learn/providers/wikipedia';
import type { LearnSupabaseClient } from '@/lib/learn/db/schema-name';
import type { StoredArticle } from './store';

/**
 * Writing a fetched article into the catalogue through the service-role
 * Supabase client.
 *
 * `store.ts` does the same over a `postgres` connection, which the scripts
 * have and the deployed app does not: Vercel has no DATABASE_URL, and the
 * background passes reach Supabase over HTTPS with the service-role key. The
 * Learn now pass (plan #806) runs there, so it writes through this.
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
      },
      { onConflict: 'provider_id,external_id' },
    )
    .select('id')
    .single();
  if (item.error) throw new Error(`Storing ${article.title} failed: ${item.error.message}`);
  const itemId = (item.data as { id: string }).id;

  const existing = await learn
    .from('catalogue_segments')
    .select('ordinal, text')
    .eq('item_id', itemId);
  if (existing.error) throw new Error(`Reading ${article.title}'s sections failed: ${existing.error.message}`);
  const storedText = new Map(
    ((existing.data ?? []) as { ordinal: number; text: string }[]).map((row) => [row.ordinal, row.text]),
  );

  const rows = article.sections.map((section) => ({
    item_id: itemId,
    ordinal: section.ordinal,
    t_start_seconds: null,
    t_end_seconds: null,
    section_anchor: section.anchor,
    heading: section.heading,
    text: section.text,
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
    if (error) throw new Error(`Storing ${article.title}'s sections failed: ${error.message}`);
  }

  const removed = await learn
    .from('catalogue_segments')
    .delete()
    .eq('item_id', itemId)
    .gte('ordinal', article.sections.length)
    .select('id');
  if (removed.error) throw new Error(`Trimming ${article.title}'s sections failed: ${removed.error.message}`);

  const segments = await learn
    .from('catalogue_segments')
    .select('id, ordinal')
    .eq('item_id', itemId)
    .order('ordinal');
  if (segments.error) throw new Error(`Reading ${article.title}'s sections failed: ${segments.error.message}`);

  return {
    itemId,
    written: article.sections.length,
    removed: (removed.data ?? []).length,
    segments: (segments.data ?? []) as { id: string; ordinal: number }[],
  };
}
