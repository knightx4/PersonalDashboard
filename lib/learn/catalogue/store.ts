import type postgres from 'postgres';
import {
  WIKIPEDIA_PROVIDER_SLUG,
  type WikipediaArticle,
} from '@/lib/learn/providers/wikipedia';

/**
 * Writing a fetched article into the catalogue.
 *
 * The catalogue tables belong to nobody -- no `user_id`, no RLS keyed to a
 * person, and no insert policy at all -- so the sweeps that fill them run as
 * `service_role`. That is why this takes a `postgres` connection rather than a
 * session client: the only caller today is scripts/learn-catalogue.ts, which
 * holds the service-role credentials, and every statement below is over
 * reference data with nobody's rows in it.
 *
 * Re-running is the normal case, not the exception. A sweep is re-run when an
 * article has changed, and the point of `(provider_id, external_id)` being
 * unique is that the second run updates the row rather than adding a second
 * one. Segments do the same on `(item_id, ordinal)`, and the sections the
 * article no longer has are deleted by ordinal afterwards, so the row count
 * follows the article rather than growing with every sweep.
 *
 * The one thing that is thrown away on a re-sweep is a stale embedding. If a
 * section's text changed, whatever vector was stored for it describes the old
 * text, and a retrieval index half of which points at text that is no longer
 * there is worse than one with a gap in it: the gap is visible in
 * `catalogue_segments_unembedded_idx` and the wrong vector is not.
 */

type Sql = postgres.Sql | postgres.TransactionSql;

export type StoredArticle = {
  itemId: string;
  /** Segments written, which is every section the article has. */
  written: number;
  /** Segments deleted because the article no longer has that section. */
  removed: number;
};

/**
 * Look up the provider row and mark it swept.
 *
 * `enabled` goes true here rather than in the migration: the seed deliberately
 * leaves every provider off until its sweep exists, and this is that sweep.
 */
async function markProviderSwept(sql: Sql, slug: string): Promise<string> {
  const [row] = await sql<{ id: string }[]>`
    update learn.catalogue_providers
       set enabled = true, last_swept_at = now()
     where slug = ${slug}
    returning id`;

  if (!row) {
    throw new Error(
      `No catalogue provider called ${slug}. Apply supabase/migrations-learn/0022_catalogue.sql.`,
    );
  }
  return row.id;
}

async function upsertItem(
  sql: Sql,
  providerId: string,
  article: WikipediaArticle,
): Promise<string> {
  const [row] = await sql<{ id: string }[]>`
    insert into learn.catalogue_items
      (provider_id, external_id, title, kind, canonical_url, length_chars)
    values (${providerId}, ${article.externalId}, ${article.title}, 'article',
            ${article.canonicalUrl}, ${article.lengthChars})
    on conflict (provider_id, external_id) do update
       set title = excluded.title,
           canonical_url = excluded.canonical_url,
           length_chars = excluded.length_chars
    returning id`;

  if (!row) throw new Error(`Storing ${article.title} wrote no item row.`);
  return row.id;
}

async function upsertSegments(
  sql: Sql,
  itemId: string,
  article: WikipediaArticle,
): Promise<void> {
  const rows = article.sections.map((section) => ({
    item_id: itemId,
    ordinal: section.ordinal,
    section_anchor: section.anchor,
    heading: section.heading,
    text: section.text,
  }));

  await sql`
    insert into learn.catalogue_segments
      ${sql(rows, 'item_id', 'ordinal', 'section_anchor', 'heading', 'text')}
    on conflict (item_id, ordinal) do update
       set section_anchor = excluded.section_anchor,
           heading = excluded.heading,
           text = excluded.text,
           embedding = case when catalogue_segments.text is distinct from excluded.text
                            then null else catalogue_segments.embedding end,
           embedding_model = case when catalogue_segments.text is distinct from excluded.text
                                  then null else catalogue_segments.embedding_model end`;
}

async function deleteTrailingSegments(sql: Sql, itemId: string, kept: number): Promise<number> {
  const removed = await sql<{ id: string }[]>`
    delete from learn.catalogue_segments
     where item_id = ${itemId} and ordinal >= ${kept}
    returning id`;
  return removed.length;
}

/** Write one article and its sections, replacing whatever was there before. */
export async function storeArticle(
  sql: postgres.Sql,
  article: WikipediaArticle,
): Promise<StoredArticle> {
  return sql.begin(async (tx) => {
    const providerId = await markProviderSwept(tx, WIKIPEDIA_PROVIDER_SLUG);
    const itemId = await upsertItem(tx, providerId, article);
    await upsertSegments(tx, itemId, article);
    const removed = await deleteTrailingSegments(tx, itemId, article.sections.length);
    return { itemId, written: article.sections.length, removed };
  }) as Promise<StoredArticle>;
}
