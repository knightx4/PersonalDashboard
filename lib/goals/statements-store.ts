import 'server-only';

import type { CollectionRecord } from '@/lib/goals/collections-store';
import type { GoalsSupabaseClient } from '@/lib/goals/db/schema-name';
import type { LearnedKind } from '@/lib/goals/document-kinds';
import {
  statementSources,
  type StatementCollection,
  type StatementSource,
} from '@/lib/goals/statements';

/**
 * The reads behind the morning run's statements (plan #1023): the owner's
 * live collections, the learned kinds that name a sender, and the live
 * records of the collections those kinds belong to. The run reads with the
 * service client, so every read is filtered to the owner.
 */
export async function loadStatementSources(
  client: GoalsSupabaseClient,
  userId: string,
  today: string,
): Promise<StatementSource[]> {
  const kindRows = await client
    .from('document_kinds')
    .select('id, collection_id, name, recognise, field_notes, skipped, senders, last_read_at')
    .eq('user_id', userId)
    .is('archived_at', null);
  if (kindRows.error)
    throw new Error(`Could not read the document kinds: ${kindRows.error.message}`);
  const kinds: LearnedKind[] = (
    (kindRows.data ?? []) as {
      id: string;
      collection_id: string;
      name: string;
      recognise: string;
      field_notes: Record<string, string> | null;
      skipped: string[] | null;
      senders: string[] | null;
      last_read_at: string | null;
    }[]
  )
    .map((row) => ({
      id: row.id,
      collectionId: row.collection_id,
      name: row.name,
      recognise: row.recognise,
      fieldNotes: row.field_notes ?? {},
      skipped: row.skipped ?? [],
      senders: row.senders ?? [],
      lastReadAt: row.last_read_at,
    }))
    .filter((k) => k.senders.length > 0);
  const ids = [...new Set(kinds.map((k) => k.collectionId))];
  if (ids.length === 0) return [];

  const [collectionRows, recordRows] = await Promise.all([
    client
      .from('collections')
      .select('id, name, shape, fields')
      .eq('user_id', userId)
      .in('id', ids)
      .is('archived_at', null),
    client
      .from('records')
      .select(
        'id, collection_id, data, version, position, source, source_ref, draft, as_of, updated_at',
      )
      .eq('user_id', userId)
      .in('collection_id', ids)
      .is('archived_at', null)
      .order('position'),
  ]);
  if (collectionRows.error) {
    throw new Error(`Could not read the collections: ${collectionRows.error.message}`);
  }
  if (recordRows.error) throw new Error(`Could not read the records: ${recordRows.error.message}`);

  const records: CollectionRecord[] = (
    (recordRows.data ?? []) as {
      id: string;
      collection_id: string;
      data: CollectionRecord['data'];
      version: number;
      position: number;
      source: CollectionRecord['source'];
      source_ref: string | null;
      draft: boolean;
      as_of: string | null;
      updated_at: string;
    }[]
  ).map((row) => ({
    id: row.id,
    collectionId: row.collection_id,
    data: row.data,
    version: row.version,
    position: row.position,
    source: row.source,
    sourceRef: row.source_ref,
    draft: row.draft,
    asOf: row.as_of,
    updatedAt: row.updated_at,
  }));

  return statementSources({
    collections: (collectionRows.data ?? []) as StatementCollection[],
    kinds,
    records,
    today,
  });
}
