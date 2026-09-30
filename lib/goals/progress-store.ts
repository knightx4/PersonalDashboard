import 'server-only';

import type { GoalsSupabaseClient } from '@/lib/goals/db/schema-name';
import {
  checkProgressEntry,
  isProgressEstimate,
  type NewProgressEntry,
  type ProgressEntry,
} from '@/lib/goals/progress';

/**
 * Reads and writes for progress entries (plan #1274). The rules are in
 * lib/goals/progress.ts.
 *
 * As everywhere in Goals, the client decides whose rows are seen and the
 * table triggers write the history. An entry is never deleted by the app:
 * Undo sets `undone_at`, and the lists here leave undone entries out.
 */

type ProgressRow = {
  id: string;
  item_id: string;
  capture_id: string | null;
  happened_on: string;
  text: string;
  quantity: number | string | null;
  unit: string | null;
  estimate: string | null;
  created_at: string;
};

const COLUMNS = 'id, item_id, capture_id, happened_on, text, quantity, unit, estimate, created_at';

const toEntry = (row: ProgressRow): ProgressEntry => ({
  id: row.id,
  itemId: row.item_id,
  captureId: row.capture_id,
  happenedOn: row.happened_on,
  text: row.text,
  quantity: row.quantity === null ? null : Number(row.quantity),
  unit: row.unit,
  estimate: isProgressEstimate(row.estimate) ? row.estimate : null,
  createdAt: row.created_at,
});

/**
 * Add an entry to a live step or goal. Null when the item is gone or
 * archived, so a capture filed against a stale page writes nothing. Throws
 * with the rule's own reason when the entry breaks one.
 */
export async function addProgressEntry(
  client: GoalsSupabaseClient,
  userId: string,
  entry: NewProgressEntry,
): Promise<string | null> {
  const checked = checkProgressEntry(entry);
  if (!checked.ok) throw new Error(checked.error);
  const value = checked.value;

  const { data: item, error: itemError } = await client
    .from('items')
    .select('id')
    .eq('id', value.itemId)
    .is('archived_at', null)
    .maybeSingle();
  if (itemError) throw new Error(itemError.message);
  if (!item) return null;

  const { data, error } = await client
    .from('progress_entries')
    .insert({
      user_id: userId,
      item_id: value.itemId,
      text: value.text,
      // Left out, the column's default is today.
      ...(value.happenedOn ? { happened_on: value.happenedOn } : {}),
      quantity: value.quantity ?? null,
      unit: value.unit ?? null,
      estimate: value.estimate ?? null,
      capture_id: value.captureId ?? null,
    })
    .select('id')
    .single();
  if (error) throw new Error(`Could not save the progress: ${error.message}`);
  return data.id as string;
}

/**
 * The entries on any of these steps or goals that have not been undone,
 * newest first (by the day it happened, then by when it was written).
 */
export async function loadProgressEntries(
  client: GoalsSupabaseClient,
  itemIds: readonly string[],
): Promise<ProgressEntry[]> {
  if (itemIds.length === 0) return [];
  const { data, error } = await client
    .from('progress_entries')
    .select(COLUMNS)
    .in('item_id', [...itemIds])
    .is('undone_at', null)
    .order('happened_on', { ascending: false })
    .order('created_at', { ascending: false });
  if (error) throw new Error(`Could not read the progress: ${error.message}`);
  return ((data ?? []) as ProgressRow[]).map(toEntry);
}

/** Take an entry back. False when there is no such entry or it was already undone. */
export async function undoProgressEntry(client: GoalsSupabaseClient, id: string): Promise<boolean> {
  const { data, error } = await client
    .from('progress_entries')
    .update({ undone_at: new Date().toISOString() })
    .eq('id', id)
    .is('undone_at', null)
    .select('id');
  if (error) throw new Error(error.message);
  return (data ?? []).length > 0;
}

/**
 * Give a step an estimated total when it has none (plan #1277), as filing
 * does from a number in its done-when. False when the step is gone or
 * already has one: a total the person set is never overwritten this way.
 */
export async function setTotalIfNone(
  client: GoalsSupabaseClient,
  stepId: string,
  total: number,
  unit: string,
): Promise<boolean> {
  const { data, error } = await client
    .from('items')
    .update({ estimated_total: total, total_unit: unit })
    .eq('id', stepId)
    .eq('level', 'step')
    .is('archived_at', null)
    .is('estimated_total', null)
    .select('id');
  if (error) throw new Error(`Could not set the total: ${error.message}`);
  return (data ?? []).length > 0;
}

/**
 * Take back a total filing set, when it still stands as it was set. One the
 * person changed since is theirs and stays.
 */
export async function clearTotalIfUnchanged(
  client: GoalsSupabaseClient,
  stepId: string,
  total: number,
): Promise<boolean> {
  const { data, error } = await client
    .from('items')
    .update({ estimated_total: null, total_unit: null })
    .eq('id', stepId)
    .eq('level', 'step')
    .eq('estimated_total', total)
    .select('id');
  if (error) throw new Error(error.message);
  return (data ?? []).length > 0;
}
