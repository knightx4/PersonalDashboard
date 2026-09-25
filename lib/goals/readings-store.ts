import 'server-only';

import type { GoalsSupabaseClient } from '@/lib/goals/db/schema-name';
import type { NumberFrom, NumberFromHow, Reading } from '@/lib/goals/readings';

/**
 * Reads and writes for a goal's number and its readings (plan #930). The
 * rules are in lib/goals/readings.ts.
 *
 * As everywhere in Goals, the client decides whose rows are seen and the
 * table triggers write the history. A reading is never updated: the database
 * refuses a change to its value or date. One entered by mistake is deleted,
 * which the history keeps, and that is also how capture's Undo takes one
 * back.
 */

type ReadingRow = {
  id: string;
  value: number | string;
  read_on: string;
  note: string | null;
  capture_id: string | null;
};

const toReading = (row: ReadingRow): Reading => ({
  id: row.id,
  value: Number(row.value),
  readOn: row.read_on,
  note: row.note,
  captureId: row.capture_id,
});

/** Every reading of one goal, oldest first. */
export async function loadReadings(client: GoalsSupabaseClient, goalId: string): Promise<Reading[]> {
  const { data, error } = await client
    .from('readings')
    .select('id, value, read_on, note, capture_id')
    .eq('item_id', goalId)
    .order('read_on')
    .order('created_at');
  if (error) throw new Error(`Could not read the readings: ${error.message}`);
  return ((data ?? []) as ReadingRow[]).map(toReading);
}

/** Set or clear what a live goal is measured in. False when there is no such goal. */
export async function setGoalMeasure(
  client: GoalsSupabaseClient,
  goalId: string,
  measure: { unit: string | null; target: number | null; dueOn?: string | null },
): Promise<boolean> {
  const { data, error } = await client
    .from('items')
    .update({
      unit: measure.unit,
      target: measure.unit ? measure.target : null,
      // Left alone unless the form sent it (plan #1025).
      ...(measure.dueOn !== undefined ? { due_on: measure.dueOn } : {}),
    })
    .eq('id', goalId)
    .eq('level', 'goal')
    .is('archived_at', null)
    .select('id');
  if (error) throw new Error(error.message);
  return (data ?? []).length > 0;
}

/**
 * Add a reading to a live goal that has a unit. Null when the goal is gone
 * or no longer measured, so a stale page or a capture filed against a goal
 * that just lost its unit writes nothing.
 */
export async function addReading(
  client: GoalsSupabaseClient,
  userId: string,
  goalId: string,
  reading: { value: number; readOn: string; note?: string | null; captureId?: string | null },
): Promise<string | null> {
  const { data: goal, error: goalError } = await client
    .from('items')
    .select('id')
    .eq('id', goalId)
    .eq('level', 'goal')
    .is('archived_at', null)
    .not('unit', 'is', null)
    .maybeSingle();
  if (goalError) throw new Error(goalError.message);
  if (!goal) return null;

  const { data, error } = await client
    .from('readings')
    .insert({
      user_id: userId,
      item_id: goalId,
      value: reading.value,
      read_on: reading.readOn,
      note: reading.note ?? null,
      capture_id: reading.captureId ?? null,
    })
    .select('id')
    .single();
  if (error) throw new Error(error.message);
  return data.id as string;
}

/** Remove a reading entered by mistake. False when it was already gone. */
export async function deleteReading(client: GoalsSupabaseClient, id: string): Promise<boolean> {
  const { data, error } = await client.from('readings').delete().eq('id', id).select('id');
  if (error) throw new Error(error.message);
  return (data ?? []).length > 0;
}

/**
 * Where a goal's number is worked out from (plan #1024), or null when it is
 * typed in by hand.
 */
export async function loadNumberFrom(
  client: GoalsSupabaseClient,
  goalId: string,
): Promise<NumberFrom | null> {
  const { data, error } = await client
    .from('items')
    .select('number_from_collection_id, number_from_field, number_from_how')
    .eq('id', goalId)
    .maybeSingle();
  if (error) throw new Error(`Could not read where the number comes from: ${error.message}`);
  const row = data as {
    number_from_collection_id: string | null;
    number_from_field: string | null;
    number_from_how: NumberFromHow | null;
  } | null;
  if (!row?.number_from_collection_id || !row.number_from_how) return null;
  return {
    collectionId: row.number_from_collection_id,
    field: row.number_from_field,
    how: row.number_from_how,
  };
}

/**
 * Work a live goal's number out from a collection, or go back to typing it
 * (null). The database checks the field and writes the first reading. A goal
 * with no unit takes `unit`, so it reads as measured from then on. False when
 * there is no such goal.
 */
export async function setNumberFrom(
  client: GoalsSupabaseClient,
  goalId: string,
  from: NumberFrom | null,
  unit: string | null,
): Promise<boolean> {
  const { data: goal, error: goalError } = await client
    .from('items')
    .select('unit')
    .eq('id', goalId)
    .eq('level', 'goal')
    .is('archived_at', null)
    .maybeSingle();
  if (goalError) throw new Error(goalError.message);
  if (!goal) return false;

  const { error } = await client
    .from('items')
    .update({
      number_from_collection_id: from?.collectionId ?? null,
      number_from_field: from?.field ?? null,
      number_from_how: from?.how ?? null,
      ...(from && !(goal as { unit: string | null }).unit && unit ? { unit } : {}),
    })
    .eq('id', goalId);
  if (error) throw new Error(error.message);
  return true;
}
