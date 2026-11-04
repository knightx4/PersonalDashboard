import 'server-only';

import type { CollectionField } from '@/lib/goals/collections';
import type { WriteResult } from '@/lib/goals/collections-store';
import {
  checkLayout,
  parseLayout,
  tileProblem,
  type DashboardContext,
  type Tile,
} from '@/lib/goals/dashboard';
import type { GoalsSupabaseClient } from '@/lib/goals/db/schema-name';
import { loadGoalSteps, loadMetrics } from '@/lib/goals/metrics-store';

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
