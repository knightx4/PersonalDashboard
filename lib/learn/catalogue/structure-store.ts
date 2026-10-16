import type postgres from 'postgres';
import { vectorLiteral } from '@/lib/learn/catalogue/embed-sweep';
import {
  deleteTrailingSegments,
  markProviderSwept,
  upsertItem,
  type Sql,
} from '@/lib/learn/catalogue/store';
import {
  structureContentHash,
  structureRow,
  unitRows,
  type LicenceMode,
  type StructureDocumentInput,
  type StructureReading,
} from '@/lib/learn/catalogue/structure';

/**
 * Writing and reading structure documents (plan #2247.1).
 *
 * Shared catalogue data, so this takes a service-role `postgres` connection
 * like store.ts: scripts and the app's `catalogueSql()` hold one.
 *
 * A re-pull is the normal case. The item is upserted on `(provider_id,
 * external_id)` as every catalogue item is, and when the raw text hashes to
 * what is already stored, nothing else is written: the units, their vectors
 * and the kept text stay as they are, and only `fetched_at` moves. When the
 * text changed, the document row is rewritten, units are upserted by ordinal,
 * a unit whose text changed loses its vector so the next embedding pass
 * embeds it again, and units past the new count are deleted.
 */

export type StoredStructure = {
  itemId: string;
  /** True when the raw text matched what was stored and nothing was rewritten. */
  unchanged: boolean;
  /** Units written; 0 when unchanged. */
  written: number;
  /** Units deleted because the document now has fewer. */
  removed: number;
};

export async function storeStructure(
  sql: postgres.Sql,
  input: StructureDocumentInput,
): Promise<StoredStructure> {
  const doc = structureRow(input);
  const units = unitRows(input.units);

  return sql.begin(async (tx) => {
    const providerId = await markProviderSwept(tx, input.providerSlug);
    const itemId = await upsertItem(tx, providerId, {
      externalId: input.externalId,
      title: input.title,
      kind: 'structure',
      canonicalUrl: input.canonicalUrl,
      lengthChars: input.rawText.length,
      durationSeconds: null,
      publishedAt: null,
    });
    await tx`update learn.catalogue_items set author = ${input.author?.trim() || null} where id = ${itemId}`;

    const [stored] = await tx<{ content_hash: string }[]>`
      select content_hash from learn.catalogue_structures where item_id = ${itemId}`;
    if (stored?.content_hash === doc.content_hash) {
      await tx`update learn.catalogue_structures set fetched_at = now() where item_id = ${itemId}`;
      return { itemId, unchanged: true, written: 0, removed: 0 };
    }

    await tx`
      insert into learn.catalogue_structures
        (item_id, institution, course_code, term, licence_mode, source_url, raw_text,
         content_hash, textbooks, outcomes, prerequisites, fetched_at)
      values (${itemId}, ${doc.institution}, ${doc.course_code}, ${doc.term}, ${doc.licence_mode},
              ${doc.source_url}, ${doc.raw_text}, ${doc.content_hash}, ${doc.textbooks}::text[],
              ${tx.json(doc.outcomes)}, ${tx.json(doc.prerequisites)}, now())
      on conflict (item_id) do update
         set institution = excluded.institution,
             course_code = excluded.course_code,
             term = excluded.term,
             licence_mode = excluded.licence_mode,
             source_url = excluded.source_url,
             raw_text = excluded.raw_text,
             content_hash = excluded.content_hash,
             textbooks = excluded.textbooks,
             outcomes = excluded.outcomes,
             prerequisites = excluded.prerequisites,
             fetched_at = excluded.fetched_at`;

    if (units.length > 0) {
      // jsonb_to_recordset rather than the bulk helper, because the helper
      // would send `readings` as a Postgres array rather than as jsonb.
      await tx`
        insert into learn.catalogue_segments
          (item_id, ordinal, unit_label, heading, topics, readings, text, searchable)
        select ${itemId}::uuid, u.ordinal, u.unit_label, u.heading, u.topics, u.readings, u.text, true
          from jsonb_to_recordset(${tx.json(units)})
               as u(ordinal int, unit_label text, heading text, topics text[], readings jsonb, text text)
        on conflict (item_id, ordinal) do update
           set unit_label = excluded.unit_label,
               heading = excluded.heading,
               topics = excluded.topics,
               readings = excluded.readings,
               text = excluded.text,
               searchable = true,
               embedding = case when catalogue_segments.text is distinct from excluded.text
                                then null else catalogue_segments.embedding end,
               embedding_model = case when catalogue_segments.text is distinct from excluded.text
                                      then null else catalogue_segments.embedding_model end,
               embedded_at = case when catalogue_segments.text is distinct from excluded.text
                                  then null else catalogue_segments.embedded_at end`;
    }
    const removed = await deleteTrailingSegments(tx, itemId, units.length);

    return { itemId, unchanged: false, written: units.length, removed };
  }) as Promise<StoredStructure>;
}

/**
 * Whether a document with this raw text is already stored, so a provider can
 * skip parsing it again. Compares the hash, never the text.
 */
export async function structureIsStored(
  sql: Sql,
  providerSlug: string,
  externalId: string,
  rawText: string,
): Promise<boolean> {
  const rows = await sql<{ one: number }[]>`
    select 1 as one
      from learn.catalogue_structures c
      join learn.catalogue_items i on i.id = c.item_id
      join learn.catalogue_providers p on p.id = i.provider_id
     where p.slug = ${providerSlug} and i.external_id = ${externalId}
       and c.content_hash = ${structureContentHash(rawText)}`;
  return rows.length > 0;
}

export type StoredStructureUnit = {
  segmentId: string;
  ordinal: number;
  label: string | null;
  heading: string;
  topics: string[];
  readings: StructureReading[];
  text: string;
  embedded: boolean;
};

export type StoredStructureDocument = {
  itemId: string;
  providerSlug: string;
  externalId: string;
  title: string;
  canonicalUrl: string;
  sourceUrl: string;
  author: string | null;
  institution: string | null;
  courseCode: string | null;
  term: string | null;
  licenceMode: LicenceMode;
  rawText: string;
  contentHash: string;
  textbooks: string[];
  outcomes: string[];
  prerequisites: string[];
  fetchedAt: Date;
  units: StoredStructureUnit[];
};

/** One stored document and its units in order, or null when none is stored. */
export async function readStructure(
  sql: Sql,
  itemId: string,
): Promise<StoredStructureDocument | null> {
  const [doc] = await sql<
    {
      item_id: string;
      slug: string;
      external_id: string;
      title: string;
      canonical_url: string;
      source_url: string;
      author: string | null;
      institution: string | null;
      course_code: string | null;
      term: string | null;
      licence_mode: LicenceMode;
      raw_text: string;
      content_hash: string;
      textbooks: string[];
      outcomes: string[];
      prerequisites: string[];
      fetched_at: Date;
    }[]
  >`
    select c.item_id, p.slug, i.external_id, i.title, i.canonical_url, c.source_url,
           i.author, c.institution, c.course_code, c.term, c.licence_mode, c.raw_text,
           c.content_hash, c.textbooks, c.outcomes, c.prerequisites, c.fetched_at
      from learn.catalogue_structures c
      join learn.catalogue_items i on i.id = c.item_id
      join learn.catalogue_providers p on p.id = i.provider_id
     where c.item_id = ${itemId}`;
  if (!doc) return null;

  const units = await sql<
    {
      id: string;
      ordinal: number;
      unit_label: string | null;
      heading: string;
      topics: string[];
      readings: StructureReading[];
      text: string;
      embedded: boolean;
    }[]
  >`
    select id, ordinal, unit_label, heading, topics, readings, text,
           embedding is not null as embedded
      from learn.catalogue_segments
     where item_id = ${itemId}
     order by ordinal`;

  return {
    itemId: doc.item_id,
    providerSlug: doc.slug,
    externalId: doc.external_id,
    title: doc.title,
    canonicalUrl: doc.canonical_url,
    sourceUrl: doc.source_url,
    author: doc.author,
    institution: doc.institution,
    courseCode: doc.course_code,
    term: doc.term,
    licenceMode: doc.licence_mode,
    rawText: doc.raw_text,
    contentHash: doc.content_hash,
    textbooks: doc.textbooks,
    outcomes: doc.outcomes,
    prerequisites: doc.prerequisites,
    fetchedAt: doc.fetched_at,
    units: units.map((unit) => ({
      segmentId: unit.id,
      ordinal: unit.ordinal,
      label: unit.unit_label,
      heading: unit.heading,
      topics: unit.topics,
      readings: unit.readings,
      text: unit.text,
      embedded: unit.embedded,
    })),
  };
}

export type NearestStructureUnit = {
  segmentId: string;
  itemId: string;
  ordinal: number;
  label: string | null;
  heading: string;
  topics: string[];
  readings: StructureReading[];
  similarity: number;
  documentTitle: string;
  canonicalUrl: string;
  institution: string | null;
  courseCode: string | null;
  term: string | null;
  licenceMode: LicenceMode;
};

/**
 * The units of any stored document nearest a query vector, closest first:
 * how a week is found by what it covers rather than by its course's title.
 * The vector is the query embedded as a query (`embedOne` with
 * `inputType: 'query'`), the same as a claim search.
 */
export async function nearestStructureUnits(
  sql: Sql,
  queryVector: number[],
  options: { limit?: number; minSimilarity?: number } = {},
): Promise<NearestStructureUnit[]> {
  const rows = await sql<
    {
      segment_id: string;
      item_id: string;
      ordinal: number;
      unit_label: string | null;
      heading: string;
      topics: string[];
      readings: StructureReading[];
      similarity: number;
      item_title: string;
      canonical_url: string;
      institution: string | null;
      course_code: string | null;
      term: string | null;
      licence_mode: LicenceMode;
    }[]
  >`
    select * from learn.nearest_structure_units(
      ${vectorLiteral(queryVector)}, ${options.limit ?? 40}, ${options.minSimilarity ?? 0.5})`;

  return rows.map((row) => ({
    segmentId: row.segment_id,
    itemId: row.item_id,
    ordinal: row.ordinal,
    label: row.unit_label,
    heading: row.heading,
    topics: row.topics,
    readings: row.readings,
    similarity: row.similarity,
    documentTitle: row.item_title,
    canonicalUrl: row.canonical_url,
    institution: row.institution,
    courseCode: row.course_code,
    term: row.term,
    licenceMode: row.licence_mode,
  }));
}
