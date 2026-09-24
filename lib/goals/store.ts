import 'server-only';

import { assertSchemaExposed } from '@/lib/core/db/schema-errors';
import { GOALS_SCHEMA, type GoalsSupabaseClient } from '@/lib/goals/db/schema-name';
import {
  nextPosition,
  reorder,
  type Area,
  type Goal,
  type GoalFields,
  type GoalStatus,
} from '@/lib/goals/tree';

/**
 * Reads and writes for areas and goals (plan #924).
 *
 * Every call takes the signed-in goals client, so row level security decides
 * whose rows are seen and every write lands in goals.history through the
 * table triggers. Nothing here writes history itself.
 *
 * Nothing is deleted. Archiving sets archived_at, which the trigger records as
 * `archive`, and every read filters archived rows out.
 */

type AreaRow = { id: string; name: string; position: number };
type GoalRow = {
  id: string;
  area_id: string;
  title: string;
  acceptance: string | null;
  fog: string | null;
  status: GoalStatus;
  position: number;
};

const toArea = (row: AreaRow): Area => ({ id: row.id, name: row.name, position: row.position });

const toGoal = (row: GoalRow): Goal => ({
  id: row.id,
  areaId: row.area_id,
  title: row.title,
  acceptance: row.acceptance,
  fog: row.fog,
  status: row.status,
  position: row.position,
});

export async function loadAreas(client: GoalsSupabaseClient): Promise<Area[]> {
  const { data, error } = await client
    .from('areas')
    .select('id, name, position')
    .is('archived_at', null)
    .order('position')
    .order('created_at');
  // A deployment where the schema is not exposed says so, not "no areas".
  assertSchemaExposed(error, GOALS_SCHEMA);
  if (error) throw new Error(`Could not read areas: ${error.message}`);
  return (data as AreaRow[]).map(toArea);
}

export async function loadGoals(client: GoalsSupabaseClient): Promise<Goal[]> {
  const { data, error } = await client
    .from('items')
    .select('id, area_id, title, acceptance, fog, status, position')
    .eq('level', 'goal')
    .is('archived_at', null)
    .order('position')
    .order('created_at');
  assertSchemaExposed(error, GOALS_SCHEMA);
  if (error) throw new Error(`Could not read goals: ${error.message}`);
  return (data as GoalRow[]).map(toGoal);
}

/** Positions re-dealt in tens across the whole list, so equal positions still move. */
async function writeOrder(
  client: GoalsSupabaseClient,
  table: 'areas' | 'items',
  order: string[],
): Promise<void> {
  const results = await Promise.all(
    order.map((id, i) => client.from(table).update({ position: (i + 1) * 10 }).eq('id', id)),
  );
  const failed = results.find((result) => result.error);
  if (failed?.error) throw new Error(failed.error.message);
}

export async function insertArea(
  client: GoalsSupabaseClient,
  userId: string,
  name: string,
): Promise<void> {
  const { data: rows, error: readError } = await client
    .from('areas')
    .select('position')
    .is('archived_at', null);
  if (readError) throw new Error(readError.message);
  const position = nextPosition((rows ?? []).map((row) => row.position as number));
  const { error } = await client.from('areas').insert({ user_id: userId, name, position });
  if (error) throw new Error(error.message);
}

/** False when no live area has that id. */
export async function renameArea(
  client: GoalsSupabaseClient,
  id: string,
  name: string,
): Promise<boolean> {
  const { data, error } = await client
    .from('areas')
    .update({ name })
    .eq('id', id)
    .is('archived_at', null)
    .select('id');
  if (error) throw new Error(error.message);
  return (data ?? []).length > 0;
}

/** False when it is already at that end. */
export async function moveArea(
  client: GoalsSupabaseClient,
  id: string,
  direction: 'up' | 'down',
): Promise<boolean> {
  const areas = await loadAreas(client);
  const order = reorder(
    areas.map((area) => area.id),
    id,
    direction,
  );
  if (!order) return false;
  await writeOrder(client, 'areas', order);
  return true;
}

/**
 * Archive an area and the goals still under it, all with the same timestamp,
 * so an undo can bring back exactly the goals that went with it. Goals first:
 * if the area's own write then fails, the page shows an empty area rather
 * than hiding goals behind one that is still listed.
 */
export async function archiveArea(client: GoalsSupabaseClient, id: string): Promise<boolean> {
  const archivedAt = new Date().toISOString();
  const { error: goalsError } = await client
    .from('items')
    .update({ archived_at: archivedAt })
    .eq('level', 'goal')
    .eq('area_id', id)
    .is('archived_at', null);
  if (goalsError) throw new Error(goalsError.message);

  const { data, error } = await client
    .from('areas')
    .update({ archived_at: archivedAt })
    .eq('id', id)
    .is('archived_at', null)
    .select('id');
  if (error) throw new Error(error.message);
  return (data ?? []).length > 0;
}

/** The undo for archiveArea: the area, and the goals archived in the same moment. */
export async function unarchiveArea(client: GoalsSupabaseClient, id: string): Promise<boolean> {
  const { data: area, error: readError } = await client
    .from('areas')
    .select('archived_at')
    .eq('id', id)
    .maybeSingle();
  if (readError) throw new Error(readError.message);
  const archivedAt = area?.archived_at as string | null | undefined;
  if (!archivedAt) return false;

  const { error } = await client.from('areas').update({ archived_at: null }).eq('id', id);
  if (error) throw new Error(error.message);
  const { error: goalsError } = await client
    .from('items')
    .update({ archived_at: null })
    .eq('level', 'goal')
    .eq('area_id', id)
    .eq('archived_at', archivedAt);
  if (goalsError) throw new Error(goalsError.message);
  return true;
}

/** A new goal at the end of its area. The area must be one of yours and live. */
export async function insertGoal(
  client: GoalsSupabaseClient,
  userId: string,
  areaId: string,
  fields: GoalFields & { title: string },
): Promise<boolean> {
  const { data: area, error: areaError } = await client
    .from('areas')
    .select('id')
    .eq('id', areaId)
    .is('archived_at', null)
    .maybeSingle();
  if (areaError) throw new Error(areaError.message);
  if (!area) return false;

  const { data: rows, error: readError } = await client
    .from('items')
    .select('position')
    .eq('level', 'goal')
    .eq('area_id', areaId)
    .is('archived_at', null);
  if (readError) throw new Error(readError.message);

  const { error } = await client.from('items').insert({
    user_id: userId,
    level: 'goal',
    area_id: areaId,
    title: fields.title,
    acceptance: fields.acceptance ?? null,
    fog: fields.fog ?? null,
    position: nextPosition((rows ?? []).map((row) => row.position as number)),
  });
  if (error) throw new Error(error.message);
  return true;
}

/** False when no live goal has that id. */
export async function updateGoal(
  client: GoalsSupabaseClient,
  id: string,
  fields: GoalFields,
): Promise<boolean> {
  const { data, error } = await client
    .from('items')
    .update(fields)
    .eq('id', id)
    .eq('level', 'goal')
    .is('archived_at', null)
    .select('id');
  if (error) throw new Error(error.message);
  return (data ?? []).length > 0;
}

/** One place up or down among the goals in its area. False when already at that end. */
export async function moveGoal(
  client: GoalsSupabaseClient,
  id: string,
  direction: 'up' | 'down',
): Promise<boolean> {
  const { data: goal, error: readError } = await client
    .from('items')
    .select('area_id')
    .eq('id', id)
    .eq('level', 'goal')
    .is('archived_at', null)
    .maybeSingle();
  if (readError) throw new Error(readError.message);
  if (!goal) return false;

  const { data: siblings, error } = await client
    .from('items')
    .select('id')
    .eq('level', 'goal')
    .eq('area_id', goal.area_id as string)
    .is('archived_at', null)
    .order('position')
    .order('created_at');
  if (error) throw new Error(error.message);

  const order = reorder(
    (siblings ?? []).map((row) => row.id as string),
    id,
    direction,
  );
  if (!order) return false;
  await writeOrder(client, 'items', order);
  return true;
}

/**
 * Archive or bring back one goal. Its steps (#925) stay as they are: they
 * are out of view with it, and come back with it.
 */
export async function setGoalArchived(
  client: GoalsSupabaseClient,
  id: string,
  archived: boolean,
): Promise<boolean> {
  let query = client
    .from('items')
    .update({ archived_at: archived ? new Date().toISOString() : null })
    .eq('id', id)
    .eq('level', 'goal');
  query = archived ? query.is('archived_at', null) : query.not('archived_at', 'is', null);
  const { data, error } = await query.select('id');
  if (error) throw new Error(error.message);
  return (data ?? []).length > 0;
}
