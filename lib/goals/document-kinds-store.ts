import 'server-only';

import type { GoalsSupabaseClient } from '@/lib/goals/db/schema-name';
import type { KindWrite, LearnedKind } from '@/lib/goals/document-kinds';

/**
 * Reads and writes of goals.document_kinds (plan #987; goals migration 0056).
 * What goes in a row is worked out in lib/goals/document-kinds.ts; this only
 * moves it. The client decides whose rows are seen, the history trigger
 * records every change, and forgetting a kind archives it.
 */

type KindRow = {
  id: string;
  collection_id: string;
  name: string;
  recognise: string;
  field_notes: Record<string, string>;
  skipped: string[];
  senders: string[] | null;
  last_read_at: string | null;
};

const COLUMNS = 'id, collection_id, name, recognise, field_notes, skipped, senders, last_read_at';

const toKind = (row: KindRow): LearnedKind => ({
  id: row.id,
  collectionId: row.collection_id,
  name: row.name,
  recognise: row.recognise,
  fieldNotes: row.field_notes ?? {},
  skipped: row.skipped ?? [],
  senders: row.senders ?? [],
  lastReadAt: row.last_read_at,
});

/** The live kinds of the given collections, by name. */
export async function loadKinds(
  client: GoalsSupabaseClient,
  collectionIds: string[],
): Promise<LearnedKind[]> {
  const ids = [...new Set(collectionIds)];
  if (ids.length === 0) return [];
  const { data, error } = await client
    .from('document_kinds')
    .select(COLUMNS)
    .in('collection_id', ids)
    .is('archived_at', null)
    .order('name');
  if (error) throw new Error(`Could not read the document kinds: ${error.message}`);
  return ((data ?? []) as KindRow[]).map(toKind);
}

/** Write what a saved read taught: a new kind, or an update to the one it read as. */
export async function writeKind(
  client: GoalsSupabaseClient,
  userId: string,
  collectionId: string,
  kind: KindWrite,
): Promise<void> {
  const values = {
    name: kind.name,
    recognise: kind.recognise,
    field_notes: kind.fieldNotes,
    skipped: kind.skipped,
    last_read_at: new Date().toISOString(),
  };
  const { error } = kind.id
    ? await client.from('document_kinds').update(values).eq('id', kind.id)
    : await client
        .from('document_kinds')
        .insert({ ...values, user_id: userId, collection_id: collectionId });
  if (error) throw new Error(`Could not keep the document kind: ${error.message}`);
}

export type KindEditResult = { ok: true } | { ok: false; error: string };

/**
 * The person's edit of a kind on the step: its name, how to recognise it,
 * who sends it, its notes and what it leaves out.
 */
export async function editKind(
  client: GoalsSupabaseClient,
  id: string,
  edit: {
    name: string;
    recognise: string;
    senders: string[];
    fieldNotes: Record<string, string>;
    skipped: string[];
  },
): Promise<KindEditResult> {
  const { data, error } = await client
    .from('document_kinds')
    .update({
      name: edit.name,
      recognise: edit.recognise,
      senders: edit.senders,
      field_notes: edit.fieldNotes,
      skipped: edit.skipped,
    })
    .eq('id', id)
    .is('archived_at', null)
    .select('id');
  if (error) {
    if (error.code === '23505') {
      return { ok: false, error: 'This form already has a kind of document with that name.' };
    }
    if (error.code === '23514') return { ok: false, error: 'Something in that is too long.' };
    throw new Error(error.message);
  }
  if (!data || data.length === 0) return { ok: false, error: 'That kind is gone. Reload to see.' };
  return { ok: true };
}

/** Forget a kind: the next document like it is read as new. */
export async function forgetKind(client: GoalsSupabaseClient, id: string): Promise<boolean> {
  const { data, error } = await client
    .from('document_kinds')
    .update({ archived_at: new Date().toISOString() })
    .eq('id', id)
    .is('archived_at', null)
    .select('id');
  if (error) throw new Error(error.message);
  return (data?.length ?? 0) > 0;
}
