import 'server-only';

import type { CoreSupabaseClient } from '@/lib/core/db/schema-name';
import type { CollectionField, RecordValues } from '@/lib/goals/collections';
import type { WriteResult } from '@/lib/goals/collections-store';
import {
  checkLayout,
  parseLayout,
  tileProblem,
  type DashboardContext,
  type Tile,
} from '@/lib/goals/dashboard';
import {
  tileView,
  type DashboardData,
  type TileList,
  type TileReading,
  type TileStep,
  type TileView,
} from '@/lib/goals/dashboard-tiles';
import type { GoalsSupabaseClient } from '@/lib/goals/db/schema-name';
import { loadGoalSteps, loadMetricCounts, loadMetrics } from '@/lib/goals/metrics-store';
import { safeTimeZone } from '@/lib/core/timezone';
import { todayIn } from '@/lib/todo/tasks/model';
import { dayIn } from '@/lib/todo/time';

/**
 * Reads and the one write of a goal's dashboard layout (plan #2778.1),
 * goals.items.dashboard. The rules are in lib/goals/dashboard.ts; every
 * writer (the app, Ask Dash, the connector) saves through saveGoalDashboard,
 * which checks the layout against the goal before it is sent. The database
 * checks the tile types again (goals.dashboard_problem, migration goals 0091)
 * and the items trigger writes the history.
 *
 * As everywhere in Goals, the client decides whose rows are seen, and every
 * query filters by the person's id as well.
 */

/** One tile as the page draws it: the tile, and what is missing when it can no longer be drawn. */
export type DashboardTile = { tile: Tile; problem: string | null };

/** What a tile may read on the goal now: its live lists, metrics and steps. */
export async function loadDashboardContext(
  client: GoalsSupabaseClient,
  userId: string,
  goalId: string,
): Promise<DashboardContext> {
  const [lists, metrics, steps] = await Promise.all([
    client
      .from('collections')
      .select('id, name, fields')
      .eq('user_id', userId)
      .eq('goal_id', goalId)
      .is('archived_at', null)
      .order('position'),
    loadMetrics(client, goalId),
    loadGoalSteps(client, goalId),
  ]);
  if (lists.error) throw new Error(`Could not read the goal's lists: ${lists.error.message}`);
  return {
    lists: (lists.data ?? []) as { id: string; name: string; fields: CollectionField[] }[],
    metrics: metrics.map((m) => ({ id: m.id, name: m.name })),
    stepIds: new Set(steps.map((s) => s.id)),
  };
}

/**
 * A goal's saved layout, each tile with its problem against the goal as it is
 * now, or null when the goal has none saved (the page then draws its default).
 * A layout that no longer parses (only a hand edit could do that) reads as
 * none, so the page never goes blank.
 */
export async function loadGoalDashboard(
  client: GoalsSupabaseClient,
  userId: string,
  goalId: string,
): Promise<DashboardTile[] | null> {
  const { data, error } = await client
    .from('items')
    .select('dashboard')
    .eq('user_id', userId)
    .eq('id', goalId)
    .eq('level', 'goal')
    .maybeSingle();
  if (error) throw new Error(`Could not read the goal's dashboard: ${error.message}`);
  const raw = (data as { dashboard: unknown } | null)?.dashboard ?? null;
  if (raw === null) return null;
  const parsed = parseLayout(raw);
  if (!parsed.ok) return null;
  const context = await loadDashboardContext(client, userId, goalId);
  return parsed.tiles.map((tile) => ({ tile, problem: tileProblem(tile, context) }));
}

/**
 * Save a goal's layout, or clear it with null. Refused, naming the tile at
 * fault, when a tile does not hold on the goal; the field is `tile-<n>` from
 * 0 for a tile, `dashboard` for the whole layout.
 */
export async function saveGoalDashboard(
  client: GoalsSupabaseClient,
  userId: string,
  goalId: string,
  raw: unknown,
): Promise<WriteResult<Tile[]>> {
  let tiles: Tile[] | null = null;
  if (raw !== null) {
    const context = await loadDashboardContext(client, userId, goalId);
    const checked = checkLayout(raw, context);
    if (!checked.ok) {
      return { ok: false, field: checked.tile === null ? 'dashboard' : `tile-${checked.tile}`, error: checked.error };
    }
    tiles = checked.tiles;
  }
  const { data, error } = await client
    .from('items')
    .update({ dashboard: tiles })
    .eq('user_id', userId)
    .eq('id', goalId)
    .eq('level', 'goal')
    .select('id');
  if (error) {
    if (error.code === '23514') {
      const message = error.message.replace(/^dashboard: /, '');
      return { ok: false, field: 'dashboard', error: message.charAt(0).toUpperCase() + message.slice(1) + '.' };
    }
    throw new Error(`Could not save the goal's dashboard: ${error.message}`);
  }
  if (!data || data.length === 0) return { ok: false, field: null, error: 'There is no such goal.' };
  return { ok: true, value: tiles ?? [] };
}

type ListRow = { id: string; name: string; fields: CollectionField[] };
type RecordRow = { id: string; collection_id: string; data: RecordValues; draft: boolean };
type ReadingRow = { record_id: string; field: string; value: number | string; read_on: string };
type StepRow = { id: string; title: string; due_on: string | null; status: string; closed_at: string | null };

/**
 * Everything a set of tiles reads on one goal (plan #2778.2): the lists the
 * tiles and the goal's metrics name, with their live records; each metric's
 * counts; the steps a countdown names; and the readings of every tracked
 * field a tile adds up or draws. Only what some tile reads is fetched.
 */
export async function loadDashboardData(
  client: GoalsSupabaseClient,
  userId: string,
  goal: { id: string; createdAt: string | null },
  tiles: readonly DashboardTile[],
  timeZone: string,
  { core, now = new Date() }: { core: CoreSupabaseClient; now?: Date },
): Promise<DashboardData> {
  const shown = tiles.filter((t) => t.problem === null).map((t) => t.tile);
  const wantsMetrics = shown.some((t) => 'metric' in t && t.metric);
  const metrics = wantsMetrics ? await loadMetricCounts(client, goal, timeZone, { core, now }) : [];

  const listIds = new Set<string>();
  for (const tile of shown) if ('list' in tile && tile.list) listIds.add(tile.list);
  for (const metric of metrics) if (metric.collectionId) listIds.add(metric.collectionId);
  const stepIds = shown.flatMap((t) => (t.type === 'countdown' && t.step ? [t.step] : []));

  const [lists, records, steps] = await Promise.all([
    listIds.size === 0
      ? Promise.resolve({ data: [] as ListRow[], error: null })
      : client.from('collections').select('id, name, fields').eq('user_id', userId).in('id', [...listIds]),
    listIds.size === 0
      ? Promise.resolve({ data: [] as RecordRow[], error: null })
      : client
          .from('records')
          .select('id, collection_id, data, draft')
          .eq('user_id', userId)
          .in('collection_id', [...listIds])
          .is('archived_at', null)
          .order('position')
          .order('created_at'),
    stepIds.length === 0
      ? Promise.resolve({ data: [] as StepRow[], error: null })
      : client.from('items').select('id, title, due_on, status, closed_at').eq('user_id', userId).in('id', stepIds),
  ]);
  if (lists.error) throw new Error(`Could not read the dashboard's lists: ${lists.error.message}`);
  if (records.error) throw new Error(`Could not read the dashboard's rows: ${records.error.message}`);
  if (steps.error) throw new Error(`Could not read the dashboard's steps: ${steps.error.message}`);

  const byList = new Map<string, TileList['records']>();
  for (const row of (records.data ?? []) as RecordRow[]) {
    const rows = byList.get(row.collection_id) ?? [];
    rows.push({ id: row.id, data: row.data, draft: row.draft });
    byList.set(row.collection_id, rows);
  }
  const tileLists: TileList[] = ((lists.data ?? []) as ListRow[]).map((l) => ({
    ...l,
    records: byList.get(l.id) ?? [],
  }));

  // Readings only for the tracked fields a tile reads: a sum or a chart of one.
  const tracked = new Set<string>();
  for (const tile of shown) {
    if ((tile.type === 'number' || tile.type === 'chart') && tile.list && tile.field) tracked.add(tile.field);
  }
  const recordIds = tileLists.flatMap((l) => l.records.map((r) => r.id));
  let readings: TileReading[] = [];
  if (tracked.size > 0 && recordIds.length > 0) {
    const { data, error } = await client
      .from('readings')
      .select('record_id, field, value, read_on')
      .eq('user_id', userId)
      .in('record_id', recordIds)
      .in('field', [...tracked])
      .order('read_on')
      .order('created_at');
    if (error) throw new Error(`Could not read the dashboard's readings: ${error.message}`);
    readings = ((data ?? []) as ReadingRow[]).map((r) => ({
      recordId: r.record_id,
      field: r.field,
      value: Number(r.value),
      readOn: r.read_on,
    }));
  }

  const zone = safeTimeZone(timeZone);
  const tileSteps: TileStep[] = ((steps.data ?? []) as StepRow[]).map((s) => ({
    id: s.id,
    title: s.title,
    dueOn: s.due_on,
    status: s.status,
    closedOn: s.closed_at ? dayIn(s.closed_at, zone) : null,
  }));

  // A broken tile whose list has left the goal is named by what the list was called.
  const goneIds = tiles.flatMap(({ tile, problem }) =>
    problem && 'list' in tile && tile.list && !listIds.has(tile.list) ? [tile.list] : [],
  );
  const goneLists: Record<string, string> = {};
  if (goneIds.length > 0) {
    const { data: gone } = await client.from('collections').select('id, name').eq('user_id', userId).in('id', goneIds);
    for (const row of (gone ?? []) as { id: string; name: string }[]) goneLists[row.id] = row.name;
  }

  return { today: todayIn(zone, now), lists: tileLists, metrics, steps: tileSteps, readings, goneLists };
}

/**
 * A goal's dashboard as the page draws it: each saved tile turned into its
 * view, broken ones naming what is missing. Null when the goal has no layout
 * saved. Tiles of a type with no view yet are left out.
 */
export async function loadGoalDashboardViews(
  client: GoalsSupabaseClient,
  userId: string,
  goal: { id: string; createdAt: string | null },
  timeZone: string,
  options: { core: CoreSupabaseClient; now?: Date },
): Promise<TileView[] | null> {
  const tiles = await loadGoalDashboard(client, userId, goal.id);
  if (tiles === null) return null;
  const data = await loadDashboardData(client, userId, goal, tiles, timeZone, options);
  return tiles
    .map(({ tile, problem }, index) => tileView(tile, index, problem, data))
    .filter((view) => view.problem !== null || view.body !== null || view.empty !== null);
}

/** Moving a tile one place, or taking it off. */
export type TileMove = { kind: 'move'; index: number; by: -1 | 1 } | { kind: 'remove'; index: number };

/**
 * Move a tile one place earlier or later, or remove it, from its menu.
 * Checked for shape only: moving or removing tiles cannot break one that was
 * whole, and a layout with a broken tile in it (a list archived since) must
 * still let the person move or remove that tile. False when the goal, its
 * layout or the tile is not there, or the move would leave the ends.
 */
export async function rearrangeGoalDashboard(
  client: GoalsSupabaseClient,
  userId: string,
  goalId: string,
  move: TileMove,
): Promise<boolean> {
  const { data, error } = await client
    .from('items')
    .select('dashboard')
    .eq('user_id', userId)
    .eq('id', goalId)
    .eq('level', 'goal')
    .maybeSingle();
  if (error) throw new Error(`Could not read the goal's dashboard: ${error.message}`);
  const parsed = parseLayout((data as { dashboard: unknown } | null)?.dashboard ?? null);
  if (!parsed.ok) return false;
  const tiles = parsed.tiles.slice();
  if (move.index < 0 || move.index >= tiles.length) return false;
  if (move.kind === 'remove') {
    tiles.splice(move.index, 1);
  } else {
    const to = move.index + move.by;
    if (to < 0 || to >= tiles.length) return false;
    [tiles[move.index], tiles[to]] = [tiles[to], tiles[move.index]];
  }
  const { data: saved, error: saveError } = await client
    .from('items')
    .update({ dashboard: tiles })
    .eq('user_id', userId)
    .eq('id', goalId)
    .eq('level', 'goal')
    .select('id');
  if (saveError) throw new Error(`Could not save the goal's dashboard: ${saveError.message}`);
  return (saved ?? []).length > 0;
}
