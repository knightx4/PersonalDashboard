import { sameAs } from './runs';
import { isUuid } from '@/lib/ask/db';
import { toRef } from '@/lib/core/refs';
import { parseLayout, TILE_TYPES, TILES_MAX, type Tile } from '@/lib/goals/dashboard';
import { findTile, layoutWords, resolveTile, tileWords, type DashboardTargets } from '@/lib/goals/dashboard-names';
import { loadDashboardTargets, rearrangeGoalDashboard, saveGoalDashboard } from '@/lib/goals/dashboard-store';
import type { GoalsSupabaseClient } from '@/lib/goals/db/schema-name';
import { GoalsRefused } from './goals-refused';
import type { GoalsMade, GoalsWrite, GoalsWriteEnv } from './goals-writes';

/**
 * change_goal_dashboard (plan #2778.9): the tiles on a goal's Dashboard tab,
 * which the person can ask for in their own words ("add a chart of my
 * balance"). Every layout is saved through saveGoalDashboard, so a tile that
 * reads a list, field, metric or step the goal does not have is refused,
 * naming it, as the page's own writes are.
 *
 *   add_tile     one tile, on the end or at a place
 *   move_tile    a tile to another place
 *   remove_tile  a tile taken off; what it read stays as it is
 *   set_layout   the whole layout at once, as when Dash lays a goal out
 *
 * The record keeps the dashboard column alone as before and after, so the
 * Undo puts back the layout and nothing else, and stands while the goal's
 * other columns change (afterValues in lib/core/dash-actions.ts).
 */

const CHANGES = ['add_tile', 'move_tile', 'remove_tile', 'set_layout'] as const;
type Change = (typeof CHANGES)[number];

type Args = Record<string, unknown>;
type Row = Record<string, unknown>;

const ITEM = 'goals.items';
const GOAL_PATHS = ['/goals', '/goals/all', '/home'];

function named(title: unknown): string {
  const line = typeof title === 'string' ? title.split('\n')[0].trim() : '';
  if (!line) return 'the goal';
  return line.length > 120 ? `${line.slice(0, 119).trimEnd()}…` : line;
}

async function goalRow(env: GoalsWriteEnv, id: string): Promise<Row | null> {
  const { data, error } = await env.goals.from('items').select('*').eq('id', id).eq('user_id', env.userId).maybeSingle();
  if (error) throw new Error(`Reading goals.items failed: ${error.message}`);
  return (data as Row | null) ?? null;
}

async function ownGoal(env: GoalsWriteEnv, id: string): Promise<Row> {
  if (!id) throw new GoalsRefused('goal_ref is missing: give the goals.items ref a lookup returned for the goal.');
  if (!isUuid(id)) throw new GoalsRefused("goal_ref must be a goal's goals.items ref, as a lookup returned it.");
  const row = await goalRow(env, id);
  if (!row || row.level !== 'goal') throw new GoalsRefused('There is no goal of theirs with that goal_ref. Look it up first.');
  if (row.archived_at != null) throw new GoalsRefused('That goal is archived. Restore it first.');
  return row;
}

/** The tiles saved now, checked for shape only. */
function savedTiles(row: Row): Tile[] {
  const parsed = parseLayout(row.dashboard ?? null);
  return parsed.ok ? parsed.tiles : [];
}

/** Each tile the request names, with its names turned into ids; refused at the first that names nothing on the goal. */
function resolveAll(raw: unknown[], targets: DashboardTargets): unknown[] {
  return raw.map((entry, index) => {
    const resolved = resolveTile(entry, targets);
    if (!resolved.ok) throw new GoalsRefused(raw.length > 1 ? `Tile ${index + 1}: ${resolved.error}` : resolved.error);
    return resolved.tile;
  });
}

/** A place from 1 the model gave, as an index from 0 within `size`; null when absent. */
function placeOf(args: Args, key: string, size: number): number | null {
  const value = args[key];
  if (value === undefined || value === null) return null;
  const n = typeof value === 'string' ? Number(value) : value;
  if (typeof n !== 'number' || !Number.isInteger(n) || n < 1 || n > size) {
    throw new GoalsRefused(`${key} is a place from 1 to ${size}.`);
  }
  return n - 1;
}

/** Save through the one check every writer uses; a refusal names the tile at fault. */
async function save(env: GoalsWriteEnv, goalId: string, tiles: unknown[]): Promise<void> {
  const saved = await saveGoalDashboard(await env.write({}), env.userId, goalId, tiles);
  if (!saved.ok) throw new GoalsRefused(saved.error);
}

async function changeGoalDashboard(env: GoalsWriteEnv, args: Args): Promise<GoalsMade> {
  const change = (typeof args.change === 'string' ? args.change.trim() : '') as Change;
  if (!CHANGES.includes(change)) throw new GoalsRefused(`change must be one of ${CHANGES.join(', ')}.`);
  const goal = await ownGoal(env, typeof args.goal_ref === 'string' ? args.goal_ref.trim() : '');
  const goalId = goal.id as string;
  const title = named(goal.title);
  const href = `/goals/${goalId}`;
  const targets = await loadDashboardTargets(env.goals as unknown as GoalsSupabaseClient, env.userId, goalId);
  const tiles = savedTiles(goal);

  let words: { verb: string; what: string; summary: string };
  if (change === 'add_tile') {
    if (tiles.length >= TILES_MAX) throw new GoalsRefused(`The dashboard already holds ${TILES_MAX} tiles. Take one off first.`);
    const [tile] = resolveAll([args.tile], targets);
    const at = placeOf(args, 'position', tiles.length + 1) ?? tiles.length;
    const next: unknown[] = [...tiles];
    next.splice(at, 0, tile);
    await save(env, goalId, next);
    const added = parseLayout([tile]);
    const said = added.ok ? tileWords(added.tiles[0], targets) : 'a tile';
    words = { verb: 'Added', what: said, summary: `Dash added ${said} to the dashboard of the goal "${title}".` };
  } else if (change === 'set_layout') {
    if (!Array.isArray(args.tiles) || args.tiles.length === 0) throw new GoalsRefused('tiles is the whole layout: a list of at least one tile.');
    const next = resolveAll(args.tiles, targets);
    await save(env, goalId, next);
    const n = next.length;
    words = {
      verb: 'Laid out',
      what: `${n} tile${n === 1 ? '' : 's'}`,
      summary: `Dash laid out the dashboard of the goal "${title}" with ${n} tile${n === 1 ? '' : 's'}.`,
    };
  } else {
    const index = findTile(tiles, args.tile, targets);
    if (index === null) throw new GoalsRefused(`Say which tile, by its place or its title. ${layoutWords(tiles, targets)}`);
    const said = tileWords(tiles[index], targets);
    const client = await env.write({});
    if (change === 'remove_tile') {
      if (!(await rearrangeGoalDashboard(client, env.userId, goalId, { kind: 'remove', index }))) {
        throw new GoalsRefused('The dashboard has changed since. Look again.');
      }
      words = { verb: 'Took off', what: said, summary: `Dash took ${said} off the dashboard of the goal "${title}".` };
    } else {
      const to = placeOf(args, 'position', tiles.length);
      if (to === null) throw new GoalsRefused(`position is the place to move it to, from 1 to ${tiles.length}.`);
      if (to === index) throw new GoalsRefused(`That tile is already at place ${to + 1}.`);
      if (!(await rearrangeGoalDashboard(client, env.userId, goalId, { kind: 'place', index, to }))) {
        throw new GoalsRefused('The dashboard has changed since. Look again.');
      }
      words = { verb: 'Moved', what: said, summary: `Dash moved ${said} to place ${to + 1} on the dashboard of the goal "${title}".` };
    }
  }

  const after = await goalRow(env, goalId);
  return {
    kind: 'change_goal_dashboard',
    input: { verb: words.verb, what: words.what, rest: ` on ${title}`, href, where: 'Open the goal', paths: [...GOAL_PATHS, href] },
    subjectRef: toRef(ITEM, goalId),
    op: 'update',
    before: { dashboard: goal.dashboard ?? null },
    after: { dashboard: after?.dashboard ?? null },
    undo: null,
    summary: words.summary,
    row: { table: ITEM, ref: goalId, title, href },
  };
}

const TILE_SHAPES =
  'number {metric} or {list, field?: a number, money or percent field, summed; without it, the count of rows}; ' +
  'countdown {step} or {list, field: a date field}; chart {style: line|bar, metric} or {list, field: a tracked number field}; ' +
  'table {list, fields?}; rooms {parent?: a step whose sub-steps are the parts; without it, the goal\'s own top steps}; ' +
  'slots {list, count: 1-50, field?: a yes/no field}; tracker {steps: [step titles in order]} or {parent}; grid {list, fields: [at least one]}. ' +
  'Every tile may have a short title.';

export const CHANGE_GOAL_DASHBOARD: GoalsWrite = {
  name: 'change_goal_dashboard',
  runs: sameAs(
    ['app/goals/[goalId]/dashboard-actions.ts#moveTileAction', 'lib/goals/dashboard-store.ts#rearrangeGoalDashboard'],
    ['app/goals/[goalId]/dashboard-actions.ts#removeTileAction', 'lib/goals/dashboard-store.ts#rearrangeGoalDashboard'],
  ),
  description:
    "Change the tiles on one of the person's goal dashboards when they ask for one in their own words (\"add a chart of my balance\", \"put the countdown first\", \"take the table off\"): add a tile (change add_tile, with tile and optionally position), move one (move_tile, with tile and position), take one off (remove_tile, with tile), or lay out the whole dashboard at once (set_layout, with tiles). " +
    `Tile shapes: ${TILE_SHAPES} ` +
    'Name lists, metrics and steps by their names on the goal and fields by their labels; a tile that reads something the goal does not have is refused, saying what it has. For move_tile and remove_tile, name the tile by its place from 1 or words from its title. Name the goal by the goals.items ref a lookup returned.',
  input_schema: {
    type: 'object',
    properties: {
      change: { type: 'string', enum: [...CHANGES], description: 'What to change.' },
      goal_ref: { type: 'string', description: 'The goals.items ref a lookup returned for the goal.' },
      tile: {
        description:
          'For add_tile: the tile, an object with type (' +
          TILE_TYPES.join(', ') +
          ') and what it reads. For move_tile and remove_tile: the tile, by its place from 1 or words from its title.',
      },
      tiles: { type: 'array', items: { type: 'object' }, description: 'For set_layout: every tile, in order, each as add_tile takes one.' },
      position: { type: 'integer', description: 'For add_tile, where to put it, from 1 (left out, on the end); for move_tile, where to move it.' },
    },
    required: ['change', 'goal_ref'],
    additionalProperties: false,
  },
  run: changeGoalDashboard,
};
