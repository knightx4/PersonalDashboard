import 'server-only';

import {
  checkRecord,
  fieldsError,
  revisionError,
  type CollectionDefinition,
  type CollectionField,
  type CollectionShape,
  type RecordSource,
  type RecordValues,
} from '@/lib/goals/collections';
import type { GoalsSupabaseClient } from '@/lib/goals/db/schema-name';

/**
 * Reads and writes of goals.collections, goals.collection_goals and
 * goals.records (plan #953). The rules are in lib/goals/collections.ts, and
 * every record write here goes through its checkRecord before it is sent. The
 * database checks the stored form again and writes the readings for tracked
 * fields, so nothing here writes to goals.readings.
 *
 * As everywhere in Goals, the client decides whose rows are seen and the
 * table triggers write the history. Records are archived, never deleted.
 */

export type Collection = CollectionDefinition & {
  id: string;
  version: number;
  /** The goals it serves, live links only. */
  goalIds: string[];
};

export type CollectionRecord = {
  id: string;
  collectionId: string;
  data: RecordValues;
  /** The collection's version these values were last written against. */
  version: number;
  position: number;
  source: RecordSource;
  sourceRef: string | null;
  /** Found for you and not yet confirmed (plan #954). */
  draft: boolean;
  updatedAt: string;
};

/** A refused write: the field is the key of the value at fault, or null for the record as a whole. */
export type WriteResult<T> = { ok: true; value: T } | { ok: false; field: string | null; error: string };

type CollectionRow = {
  id: string;
  name: string;
  shape: CollectionShape;
  fields: CollectionField[];
  version: number;
  collection_goals: { goal_id: string; archived_at: string | null }[] | null;
};

type RecordRow = {
  id: string;
  collection_id: string;
  data: RecordValues;
  version: number;
  position: number;
  source: RecordSource;
  source_ref: string | null;
  draft: boolean;
  updated_at: string;
};

const COLLECTION_COLUMNS = 'id, name, shape, fields, version, collection_goals(goal_id, archived_at)';
const RECORD_COLUMNS = 'id, collection_id, data, version, position, source, source_ref, draft, updated_at';

const toCollection = (row: CollectionRow): Collection => ({
  id: row.id,
  name: row.name,
  shape: row.shape,
  fields: row.fields,
  version: row.version,
  goalIds: (row.collection_goals ?? []).filter((g) => g.archived_at === null).map((g) => g.goal_id),
});

const toRecord = (row: RecordRow): CollectionRecord => ({
  id: row.id,
  collectionId: row.collection_id,
  data: row.data,
  version: row.version,
  position: row.position,
  source: row.source,
  sourceRef: row.source_ref,
  draft: row.draft,
  updatedAt: row.updated_at,
});

/**
 * A database refusal the person can act on. The records trigger raises
 * check_violation with the field's key in the detail; the other checks name
 * the record as a whole.
 */
function refusal(error: { code?: string; message: string; details?: string | null }): {
  field: string | null;
  error: string;
} | null {
  if (error.code !== '23514' && error.code !== '23505') return null;
  const message = error.message.replace(/^(records|collections|collection_goals): /, '');
  if (error.code === '23505') return { field: null, error: 'There is already a collection with that name.' };
  return { field: error.details || null, error: message.charAt(0).toUpperCase() + message.slice(1) };
}

/** One live collection, or null. */
export async function loadCollection(client: GoalsSupabaseClient, id: string): Promise<Collection | null> {
  const { data, error } = await client
    .from('collections')
    .select(COLLECTION_COLUMNS)
    .eq('id', id)
    .is('archived_at', null)
    .maybeSingle();
  if (error) throw new Error(`Could not read the collection: ${error.message}`);
  return data ? toCollection(data as CollectionRow) : null;
}

/** The live collections serving one goal, by name. */
export async function loadCollectionsForGoal(
  client: GoalsSupabaseClient,
  goalId: string,
): Promise<Collection[]> {
  const { data, error } = await client
    .from('collections')
    .select(`${COLLECTION_COLUMNS}, served:collection_goals!inner(goal_id, archived_at)`)
    .eq('served.goal_id', goalId)
    .is('served.archived_at', null)
    .is('archived_at', null)
    .order('name');
  if (error) throw new Error(`Could not read the collections: ${error.message}`);
  return ((data ?? []) as CollectionRow[]).map(toCollection);
}

/** The live records of a collection, in order. */
export async function loadRecords(
  client: GoalsSupabaseClient,
  collectionId: string,
): Promise<CollectionRecord[]> {
  const { data, error } = await client
    .from('records')
    .select(RECORD_COLUMNS)
    .eq('collection_id', collectionId)
    .is('archived_at', null)
    .order('position')
    .order('created_at');
  if (error) throw new Error(`Could not read the records: ${error.message}`);
  return ((data ?? []) as RecordRow[]).map(toRecord);
}

/**
 * Live collections by id, each with its live records, for the information
 * steps on a page (plan #954). A collection that is gone is left out.
 */
export async function loadInformation(
  client: GoalsSupabaseClient,
  collectionIds: string[],
): Promise<Record<string, { collection: Collection; records: CollectionRecord[] }>> {
  const ids = [...new Set(collectionIds)];
  if (ids.length === 0) return {};
  const [collections, records] = await Promise.all([
    client.from('collections').select(COLLECTION_COLUMNS).in('id', ids).is('archived_at', null),
    client
      .from('records')
      .select(RECORD_COLUMNS)
      .in('collection_id', ids)
      .is('archived_at', null)
      .order('position')
      .order('created_at'),
  ]);
  if (collections.error) {
    throw new Error(`Could not read the collections: ${collections.error.message}`);
  }
  if (records.error) throw new Error(`Could not read the records: ${records.error.message}`);
  const out: Record<string, { collection: Collection; records: CollectionRecord[] }> = {};
  for (const row of (collections.data ?? []) as CollectionRow[]) {
    out[row.id] = { collection: toCollection(row), records: [] };
  }
  for (const row of (records.data ?? []) as RecordRow[]) {
    out[row.collection_id]?.records.push(toRecord(row));
  }
  return out;
}

/** Define a collection and link it to the goals it serves. */
export async function createCollection(
  client: GoalsSupabaseClient,
  userId: string,
  definition: CollectionDefinition,
  goalIds: string[],
): Promise<WriteResult<string>> {
  const problem = fieldsError(definition.fields);
  if (problem) return { ok: false, field: null, error: problem };

  const { data, error } = await client
    .from('collections')
    .insert({ user_id: userId, name: definition.name, shape: definition.shape, fields: definition.fields })
    .select('id')
    .single();
  if (error) {
    const refused = refusal(error);
    if (refused) return { ok: false, ...refused };
    throw new Error(error.message);
  }
  const id = data.id as string;
  for (const goalId of goalIds) await serveGoal(client, userId, id, goalId);
  return { ok: true, value: id };
}

/**
 * Replace a collection's fields. A field is never taken out, only marked
 * removed, and keeps its type; the database raises the version.
 */
export async function reviseFields(
  client: GoalsSupabaseClient,
  collectionId: string,
  fields: CollectionField[],
): Promise<WriteResult<number>> {
  const current = await loadCollection(client, collectionId);
  if (!current) return { ok: false, field: null, error: 'That collection is gone.' };
  const problem = revisionError(current.fields, fields);
  if (problem) return { ok: false, field: null, error: problem };

  const { data, error } = await client
    .from('collections')
    .update({ fields })
    .eq('id', collectionId)
    .select('version')
    .single();
  if (error) {
    const refused = refusal(error);
    if (refused) return { ok: false, ...refused };
    throw new Error(error.message);
  }
  return { ok: true, value: data.version as number };
}

/** Have a collection serve a goal, or bring back the link it had. */
export async function serveGoal(
  client: GoalsSupabaseClient,
  userId: string,
  collectionId: string,
  goalId: string,
): Promise<void> {
  const { error } = await client
    .from('collection_goals')
    .upsert(
      { user_id: userId, collection_id: collectionId, goal_id: goalId, archived_at: null },
      { onConflict: 'collection_id,goal_id' },
    );
  if (error) throw new Error(error.message);
}

/** Add a record. Values arrive as typed or found; they are checked and stored in their own form. */
export async function addRecord(
  client: GoalsSupabaseClient,
  userId: string,
  collectionId: string,
  values: Record<string, unknown>,
  source: { kind: RecordSource; ref?: string | null; draft?: boolean } = { kind: 'typed' },
  position = 0,
): Promise<WriteResult<string>> {
  const collection = await loadCollection(client, collectionId);
  if (!collection) return { ok: false, field: null, error: 'That collection is gone.' };
  const checked = checkRecord(collection.fields, values, null);
  if (!checked.ok) return checked;

  const { data, error } = await client
    .from('records')
    .insert({
      user_id: userId,
      collection_id: collectionId,
      data: checked.data,
      source: source.kind,
      source_ref: source.ref ?? null,
      draft: source.draft ?? false,
      position,
    })
    .select('id')
    .single();
  if (error) {
    const refused = refusal(error);
    if (refused) return { ok: false, ...refused };
    throw new Error(error.message);
  }
  return { ok: true, value: data.id as string };
}

/**
 * Change some of a record's values. Values the write does not mention are
 * kept, so a removed field's old value stays in the record. `confirm` also
 * takes a draft out of draft, as saving your correction of one does.
 */
export async function updateRecord(
  client: GoalsSupabaseClient,
  recordId: string,
  values: Record<string, unknown>,
  source?: { kind: RecordSource; ref?: string | null },
  { confirm = false }: { confirm?: boolean } = {},
): Promise<WriteResult<CollectionRecord>> {
  const { data: row, error: readError } = await client
    .from('records')
    .select(RECORD_COLUMNS)
    .eq('id', recordId)
    .is('archived_at', null)
    .maybeSingle();
  if (readError) throw new Error(readError.message);
  if (!row) return { ok: false, field: null, error: 'That record is gone.' };
  const record = toRecord(row as RecordRow);

  const collection = await loadCollection(client, record.collectionId);
  if (!collection) return { ok: false, field: null, error: 'That collection is gone.' };
  const checked = checkRecord(collection.fields, values, record.data);
  if (!checked.ok) return checked;

  const patch: Record<string, unknown> = { data: checked.data };
  if (source) {
    patch.source = source.kind;
    patch.source_ref = source.ref ?? null;
  }
  if (confirm) patch.draft = false;
  const { data, error } = await client
    .from('records')
    .update(patch)
    .eq('id', recordId)
    .select(RECORD_COLUMNS)
    .single();
  if (error) {
    const refused = refusal(error);
    if (refused) return { ok: false, ...refused };
    throw new Error(error.message);
  }
  return { ok: true, value: toRecord(data as RecordRow) };
}

/** Archive a record. It leaves the form and stays in the history. False when it was already gone. */
export async function archiveRecord(client: GoalsSupabaseClient, recordId: string): Promise<boolean> {
  const { data, error } = await client
    .from('records')
    .update({ archived_at: new Date().toISOString() })
    .eq('id', recordId)
    .is('archived_at', null)
    .select('id');
  if (error) throw new Error(error.message);
  return (data ?? []).length > 0;
}

/**
 * Confirm a draft as it stands: it keeps its values and where they came from,
 * and stops being a draft. False when it was not a live draft.
 */
export async function confirmRecord(client: GoalsSupabaseClient, recordId: string): Promise<boolean> {
  const { data, error } = await client
    .from('records')
    .update({ draft: false })
    .eq('id', recordId)
    .eq('draft', true)
    .is('archived_at', null)
    .select('id');
  if (error) throw new Error(error.message);
  return (data ?? []).length > 0;
}

/** Bring back an archived record, for Undo. False when it was not archived. */
export async function restoreRecord(client: GoalsSupabaseClient, recordId: string): Promise<boolean> {
  const { data, error } = await client
    .from('records')
    .update({ archived_at: null })
    .eq('id', recordId)
    .not('archived_at', 'is', null)
    .select('id');
  if (error) throw new Error(error.message);
  return (data ?? []).length > 0;
}
