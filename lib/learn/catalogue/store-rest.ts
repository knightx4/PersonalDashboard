import { WIKIPEDIA_PROVIDER_SLUG, type WikipediaArticle } from '@/lib/learn/providers/wikipedia';
import type { LearnSupabaseClient } from '@/lib/learn/db/schema-name';
import { passageRowsForSections } from './passages';
import type { CatalogueSegmentInput, StoredArticle, StoredPassages } from './store';

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
 * embedding cleared. A section cut as not searchable is written the same way,
 * so it never keeps a vector.
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

  const rows = article.sections.map((section) => ({
    ordinal: section.ordinal,
    tStartSeconds: null,
    tEndSeconds: null,
    sectionAnchor: section.anchor,
    heading: section.heading,
    text: section.text,
    searchable: section.searchable,
  }));
  const { removed, segments } = await writeSegmentsOverRest(learn, itemId, rows, article.title);
  const passages = await storePassagesForItemOverRest(learn, itemId, article.title);

  return {
    itemId,
    written: article.sections.length,
    removed,
    passages: passages.written,
    segments,
  };
}

/**
 * Cut an article's stored sections into passages and write them, over HTTPS.
 *
 * `storePassagesForItem` in store.ts does the same over a `postgres`
 * connection, and the rules are its rules: only items of kind `article`, the
 * sections as stored, upserted on `(segment_id, ordinal)`, a passage whose
 * text changed written with its vector cleared, an unchanged one left alone,
 * and passages past a section's new count deleted. Re-running it writes
 * nothing. The backfill (#1133) can call it on each stored article.
 */
export async function storePassagesForItemOverRest(
  learn: LearnSupabaseClient,
  itemId: string,
  label = itemId,
): Promise<StoredPassages> {
  const sections = await learn
    .from('catalogue_segments')
    .select('id, heading, text, catalogue_items!catalogue_segments_item_id_fkey!inner(kind)')
    .eq('item_id', itemId)
    .eq('catalogue_items.kind', 'article')
    .order('ordinal');
  if (sections.error) throw new Error(`Reading ${label}'s sections failed: ${sections.error.message}`);
  const stored = (sections.data ?? []) as { id: string; heading: string | null; text: string }[];
  if (stored.length === 0) return { written: 0, removed: 0 };

  const existing = await learn
    .from('catalogue_passages')
    .select('id, segment_id, ordinal, text')
    .in(
      'segment_id',
      stored.map((section) => section.id),
    );
  if (existing.error) throw new Error(`Reading ${label}'s passages failed: ${existing.error.message}`);
  const had = (existing.data ?? []) as { id: string; segment_id: string; ordinal: number; text: string }[];
  const storedText = new Map(had.map((row) => [`${row.segment_id}:${row.ordinal}`, row.text]));

  const rows = passageRowsForSections(stored);
  const changed = rows
    .filter((row) => storedText.get(`${row.segment_id}:${row.ordinal}`) !== row.text)
    .map((row) => ({ ...row, embedding: null, embedding_model: null, embedded_at: null }));
  if (changed.length > 0) {
    const { error } = await learn
      .from('catalogue_passages')
      .upsert(changed, { onConflict: 'segment_id,ordinal' });
    if (error) throw new Error(`Storing ${label}'s passages failed: ${error.message}`);
  }

  const counts = new Map<string, number>();
  for (const row of rows) counts.set(row.segment_id, (counts.get(row.segment_id) ?? 0) + 1);
  const stale = had.filter((row) => row.ordinal >= (counts.get(row.segment_id) ?? 0)).map((row) => row.id);
  if (stale.length > 0) {
    const { error } = await learn.from('catalogue_passages').delete().in('id', stale);
    if (error) throw new Error(`Trimming ${label}'s passages failed: ${error.message}`);
  }

  return { written: rows.length, removed: stale.length };
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
    searchable: segment.searchable ?? true,
  }));
  // A section that is not searchable is written with its vector cleared too,
  // because `catalogue_segments_searchable_ck` refuses one that keeps it.
  const keepsVector = (row: (typeof rows)[number]): boolean =>
    row.searchable && storedText.get(row.ordinal) === row.text;
  const changed = rows
    .filter((row) => !keepsVector(row))
    .map((row) => ({ ...row, embedding: null, embedding_model: null, embedded_at: null }));
  const unchanged = rows.filter(keepsVector);

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
