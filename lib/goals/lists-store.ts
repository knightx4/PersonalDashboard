import 'server-only';

import { fieldsError, type CollectionField, type RecordValues } from '@/lib/goals/collections';
import {
  addRecord,
  reviseFields,
  type CollectionRecord,
  type WriteResult,
} from '@/lib/goals/collections-store';
import type { GoalsSupabaseClient } from '@/lib/goals/db/schema-name';
import {
  DEFAULT_LIST_FIELDS,
  LISTS_PER_GOAL_MAX,
  fieldsForProduct,
  productValues,
  type ProductPart,
  type ReadProduct,
} from '@/lib/goals/lists';

/**
 * Reads and writes of a goal's own lists (plan #2330.2): goals.collections
 * rows with goal_id set, and their goals.records. The rules are in
 * lib/goals/lists.ts and lib/goals/collections.ts; the database checks every
 * value again and serves the list to its goal.
 *
 * Like the rest of Goals, these rely on the client to decide whose rows are
 * seen: every query filters by the person's id as well, so the connector's
 * service-role client reads only theirs.
 */

/** One of a goal's lists with its live rows, drafts among them, in order. */
export type GoalList = {
  id: string;
  goalId: string;
  name: string;
  position: number;
  fields: CollectionField[];
  version: number;
  rows: CollectionRecord[];
};

type ListRow = {
  id: string;
  goal_id: string;
  name: string;
  position: number;
  fields: CollectionField[];
  version: number;
};

type RecordRow = {
  id: string;
  collection_id: string;
  data: RecordValues;
  version: number;
  position: number;
  source: CollectionRecord['source'];
  source_ref: string | null;
  draft: boolean;
  as_of: string | null;
  updated_at: string;
};

const LIST_COLUMNS = 'id, goal_id, name, position, fields, version';
const RECORD_COLUMNS = 'id, collection_id, data, version, position, source, source_ref, draft, as_of, updated_at';

const toRow = (row: RecordRow): CollectionRecord => ({
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
});

/** A goal's live lists, in their order, each with its live rows. */
export async function loadGoalLists(
  client: GoalsSupabaseClient,
  userId: string,
  goalId: string,
): Promise<GoalList[]> {
  const { data, error } = await client
    .from('collections')
    .select(LIST_COLUMNS)
    .eq('user_id', userId)
    .eq('goal_id', goalId)
    .is('archived_at', null)
    .order('position');
  if (error) throw new Error(`Could not read the goal's lists: ${error.message}`);
  const lists = (data ?? []) as ListRow[];
  if (lists.length === 0) return [];

  const { data: records, error: recordsError } = await client
    .from('records')
    .select(RECORD_COLUMNS)
    .eq('user_id', userId)
    .in(
      'collection_id',
      lists.map((list) => list.id),
    )
    .is('archived_at', null)
    .order('position')
    .order('created_at');
  if (recordsError) throw new Error(`Could not read the lists' rows: ${recordsError.message}`);

  const byList = new Map<string, CollectionRecord[]>();
  for (const row of (records ?? []) as RecordRow[]) {
    const rows = byList.get(row.collection_id) ?? [];
    rows.push(toRow(row));
    byList.set(row.collection_id, rows);
  }
  return lists.map((list) => ({
    id: list.id,
    goalId: list.goal_id,
    name: list.name,
    position: list.position,
    fields: list.fields,
    version: list.version,
    rows: byList.get(list.id) ?? [],
  }));
}

/** One live list of the person's, by its id, or null. */
export async function loadGoalList(
  client: GoalsSupabaseClient,
  userId: string,
  listId: string,
): Promise<Omit<GoalList, 'rows'> | null> {
  const { data, error } = await client
    .from('collections')
    .select(LIST_COLUMNS)
    .eq('user_id', userId)
    .eq('id', listId)
    .is('archived_at', null)
    .maybeSingle();
  if (error) throw new Error(`Could not read the list: ${error.message}`);
  const row = data as ListRow | null;
  if (!row || !row.goal_id) return null;
  return { id: row.id, goalId: row.goal_id, name: row.name, position: row.position, fields: row.fields, version: row.version };
}

/**
 * Start a list on a goal, after the ones it has. With no fields it holds a
 * name, a link and notes. The database makes it serve the goal.
 */
export async function createGoalList(
  client: GoalsSupabaseClient,
  userId: string,
  goalId: string,
  name: string,
  fields: CollectionField[] = DEFAULT_LIST_FIELDS,
): Promise<WriteResult<string>> {
  const problem = fieldsError(fields);
  if (problem) return { ok: false, field: null, error: problem };
  const existing = await loadGoalLists(client, userId, goalId);
  if (existing.length >= LISTS_PER_GOAL_MAX) {
    return { ok: false, field: null, error: `A goal holds at most ${LISTS_PER_GOAL_MAX} lists.` };
  }
  if (existing.some((list) => list.name.trim().toLowerCase() === name.trim().toLowerCase())) {
    return { ok: false, field: null, error: `The goal has a list called ${name} already.` };
  }
  const position = existing.reduce((max, list) => Math.max(max, list.position + 1), 0);
  const { data, error } = await client
    .from('collections')
    .insert({ user_id: userId, goal_id: goalId, name, shape: 'list', fields, position })
    .select('id')
    .single();
  if (error) {
    // Until migration 0081 is applied, a collection's name is unique across the account.
    if (error.code === '23505') return { ok: false, field: null, error: 'Another of their lists has that name. Give this one another.' };
    if (error.code === '23514') return { ok: false, field: null, error: error.message.replace(/^collections: /, '') };
    throw new Error(error.message);
  }
  return { ok: true, value: (data as { id: string }).id };
}

/** Rename a list. False when it was already gone. */
export async function renameGoalList(client: GoalsSupabaseClient, listId: string, name: string): Promise<WriteResult<boolean>> {
  const { data, error } = await client
    .from('collections')
    .update({ name })
    .eq('id', listId)
    .is('archived_at', null)
    .select('id');
  if (error) {
    if (error.code === '23505') return { ok: false, field: null, error: 'Another of their lists has that name.' };
    throw new Error(error.message);
  }
  return { ok: true, value: (data ?? []).length > 0 };
}

/** Archive a list. Its rows stay with it, and restoring it brings them back. False when it was already archived. */
export async function archiveGoalList(client: GoalsSupabaseClient, listId: string): Promise<boolean> {
  const { data, error } = await client
    .from('collections')
    .update({ archived_at: new Date().toISOString() })
    .eq('id', listId)
    .is('archived_at', null)
    .select('id');
  if (error) throw new Error(error.message);
  return (data ?? []).length > 0;
}

/** The next position at the end of a list, so a new row goes last. */
async function nextPosition(client: GoalsSupabaseClient, listId: string): Promise<number> {
  const { data, error } = await client
    .from('records')
    .select('position')
    .eq('collection_id', listId)
    .is('archived_at', null)
    .order('position', { ascending: false })
    .limit(1);
  if (error) throw new Error(error.message);
  const last = (data ?? [])[0] as { position: number } | undefined;
  return last ? last.position + 1 : 0;
}

/** Add a row of values to a list, at its end. */
export async function addListRow(
  client: GoalsSupabaseClient,
  userId: string,
  listId: string,
  values: Record<string, unknown>,
): Promise<WriteResult<string>> {
  return addRecord(client, userId, listId, values, { kind: 'typed' }, await nextPosition(client, listId));
}

/** What a pasted link added: the draft row, and what the page did not give. */
export type FromLink = { recordId: string; missing: ProductPart[]; addedFields: string[] };

/**
 * Add a row to a list from a pasted product link: the page is read for its
 * name, picture and price (lib/saved/scrape-product.ts, passed in as `read`),
 * the list gains whichever of those fields it lacks, and the row goes in as a
 * draft for the person to confirm, with the link as where it came from.
 *
 * A link the reader refuses (a private address, not a web page) is refused
 * here with its reason. A page that gives nothing still adds the row with
 * the link, and `missing` says what it did not give.
 */
export async function addListRowFromLink(
  client: GoalsSupabaseClient,
  userId: string,
  listId: string,
  url: string,
  read: (url: string) => Promise<ReadProduct>,
): Promise<WriteResult<FromLink>> {
  const list = await loadGoalList(client, userId, listId);
  if (!list) return { ok: false, field: null, error: 'That list is gone.' };

  let product: ReadProduct;
  try {
    product = await read(url);
  } catch (error) {
    return { ok: false, field: null, error: error instanceof Error ? error.message : 'That link could not be read.' };
  }

  const fields = fieldsForProduct(list.fields);
  const addedFields = fields.slice(list.fields.length).map((f) => f.label);
  if (addedFields.length > 0) {
    const revised = await reviseFields(client, listId, fields);
    if (!revised.ok) return revised;
  }

  const { values, missing } = productValues(fields, product);
  const added = await addRecord(
    client,
    userId,
    listId,
    values,
    { kind: 'pasted', ref: product.url, draft: true },
    await nextPosition(client, listId),
  );
  if (!added.ok) return added;
  return { ok: true, value: { recordId: added.value, missing, addedFields } };
}
