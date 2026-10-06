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

type AreaRow = { id: string; name: string; note: string | null; position: number; learn?: boolean };
type GoalRow = {
  id: string;
  area_id: string;
  title: string;
  acceptance: string | null;
  fog: string | null;
  status: GoalStatus;
  position: number;
  unit: string | null;
  target: number | string | null;
  due_on: string | null;
  errand: boolean;
  focus?: boolean;
  archived_at?: string | null;
};

const toArea = (row: AreaRow): Area => ({
  id: row.id,
  name: row.name,
  note: row.note ?? null,
  position: row.position,
  learn: row.learn ?? false,
});

const toGoal = (row: GoalRow): Goal => ({
  id: row.id,
  areaId: row.area_id,
  title: row.title,
  acceptance: row.acceptance,
  fog: row.fog,
  status: row.status,
  position: row.position,
  unit: row.unit,
  target: row.target === null ? null : Number(row.target),
  dueOn: row.due_on,
  errand: row.errand,
  focus: row.focus ?? false,
  archivedAt: row.archived_at ?? null,
});

export async function loadAreas(client: GoalsSupabaseClient): Promise<Area[]> {
  const { data, error } = await client
    .from('areas')
    .select('id, name, note, position, learn')
    .is('archived_at', null)
    .order('position')
    .order('created_at');
  // A deployment where the schema is not exposed says so, not "no areas".
  assertSchemaExposed(error, GOALS_SCHEMA);
  if (error) throw new Error(`Could not read areas: ${error.message}`);
  return (data as AreaRow[]).map(toArea);
}

/**
 * The goals in page order. `archived` takes the archived ones too, for All
 * goals' Everything view (plan #1158); every other read leaves them out.
 */
export async function loadGoals(
  client: GoalsSupabaseClient,
  { archived = false }: { archived?: boolean } = {},
): Promise<Goal[]> {
  let query = client
    .from('items')
    .select('id, area_id, title, acceptance, fog, status, position, unit, target, due_on, errand, focus, archived_at')
    .eq('level', 'goal');
  if (!archived) query = query.is('archived_at', null);
  const { data, error } = await query.order('position').order('created_at');
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
    order.map((id, i) =>
      client
        .from(table)
        .update({ position: (i + 1) * 10 })
        .eq('id', id),
    ),
  );
  const failed = results.find((result) => result.error);
  if (failed?.error) throw new Error(failed.error.message);
}

/** A new area at the end of yours, and its id. */
export async function insertArea(
  client: GoalsSupabaseClient,
  userId: string,
  name: string,
): Promise<string> {
  const { data: rows, error: readError } = await client
    .from('areas')
    .select('position')
    .is('archived_at', null);
  if (readError) throw new Error(readError.message);
  const position = nextPosition((rows ?? []).map((row) => row.position as number));
  const { data, error } = await client
    .from('areas')
    .insert({ user_id: userId, name, position })
    .select('id')
    .single();
  if (error) throw new Error(error.message);
  return data.id as string;
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

/** Write or clear what you want from an area. False when no live area has that id. */
export async function setAreaNote(
  client: GoalsSupabaseClient,
  id: string,
  note: string | null,
): Promise<boolean> {
  const { data, error } = await client
    .from('areas')
    .update({ note })
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

/**
 * A new goal at the end of its area, and its id. Null when the area is not one
 * of yours and live. `detail` is for a goal made from something that already
 * has notes, such as a Todo task handed to Dash (plan #1263); the form on the
 * Goals home does not send one.
 */
export async function insertGoal(
  client: GoalsSupabaseClient,
  userId: string,
  areaId: string,
  fields: GoalFields & { title: string; detail?: string | null },
): Promise<string | null> {
  const { data: area, error: areaError } = await client
    .from('areas')
    .select('id')
    .eq('id', areaId)
    .is('archived_at', null)
    .maybeSingle();
  if (areaError) throw new Error(areaError.message);
  if (!area) return null;

  const { data: rows, error: readError } = await client
    .from('items')
    .select('position')
    .eq('level', 'goal')
    .eq('area_id', areaId)
    .is('archived_at', null);
  if (readError) throw new Error(readError.message);

  const { data: inserted, error } = await client
    .from('items')
    .insert({
      user_id: userId,
      level: 'goal',
      area_id: areaId,
      title: fields.title,
      acceptance: fields.acceptance ?? null,
      fog: fields.fog ?? null,
      detail: fields.detail ?? null,
      errand: fields.errand ?? false,
      due_on: fields.dueOn ?? null,
      position: nextPosition((rows ?? []).map((row) => row.position as number)),
    })
    .select('id')
    .single();
  if (error) throw new Error(error.message);
  return inserted.id as string;
}

/**
 * False when no live goal has that id, or when the area it is moved to is not
 * one of your live areas. A move (plan #1160) puts the goal at the end of the
 * new area's list; its steps hang from the goal rather than the area, so they
 * go with it untouched, and the history trigger records the old and new area.
 */
export async function updateGoal(
  client: GoalsSupabaseClient,
  id: string,
  fields: GoalFields,
): Promise<boolean> {
  const { areaId, errand, dueOn, ...rest } = fields;
  const change: Record<string, unknown> = { ...rest };
  // An errand and its date go in one write, so the check that an errand has a
  // due date (goals 0061) sees both at once.
  if (errand !== undefined) change.errand = errand;
  if (dueOn !== undefined) change.due_on = dueOn;

  if (areaId !== undefined) {
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
      .select('id, position')
      .eq('level', 'goal')
      .eq('area_id', areaId)
      .is('archived_at', null);
    if (readError) throw new Error(readError.message);
    // Already in that area: nothing to move, and the goal keeps its place.
    if (!(rows ?? []).some((row) => row.id === id)) {
      change.area_id = areaId;
      change.position = nextPosition((rows ?? []).map((row) => row.position as number));
    }
  }

  if (Object.keys(change).length === 0) {
    const { data, error } = await client
      .from('items')
      .select('id')
      .eq('id', id)
      .eq('level', 'goal')
      .is('archived_at', null);
    if (error) throw new Error(error.message);
    return (data ?? []).length > 0;
  }

  const { data, error } = await client
    .from('items')
    .update(change)
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

/**
 * Your answer to a proposal to close or park a goal, or taking one back up
 * (plan #1084). `close` and `park` act on an open goal; `keep` records that
 * you kept it open, so the proposal is not made again on the same reading;
 * `reopen` brings a parked or closed goal back to open and counts as keeping
 * it open. False when the goal is not in the state the move starts from.
 */
export type GoalMove = 'close' | 'park' | 'keep' | 'reopen';

export async function settleGoal(
  client: GoalsSupabaseClient,
  id: string,
  move: GoalMove,
): Promise<boolean> {
  const now = new Date().toISOString();
  const change =
    move === 'close'
      ? { status: 'done' }
      : move === 'park'
        ? { status: 'parked' }
        : move === 'keep'
          ? { kept_open_at: now }
          : { status: 'open', kept_open_at: now };
  let query = client
    .from('items')
    .update(change)
    .eq('id', id)
    .eq('level', 'goal')
    .is('archived_at', null);
  query = move === 'reopen' ? query.in('status', ['parked', 'done']) : query.eq('status', 'open');
  const { data, error } = await query.select('id');
  if (error) throw new Error(error.message);
  return (data ?? []).length > 0;
}
