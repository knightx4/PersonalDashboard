/**
 * A goal's dashboard layout (plan #2778.1): the ordered tiles its Dashboard
 * tab draws, kept in goals.items.dashboard (migration goals 0091).
 *
 * Every writer saves through checkLayout, so a broken layout is refused when
 * it is saved, with the tile at fault named, rather than drawing a blank page
 * later. The database checks the part that holds whatever the goal's lists
 * say (an array of at most TILES_MAX objects, each with a type from
 * TILE_TYPES); this file also checks that each list, metric, step and field a
 * tile names is on the goal.
 *
 * Two passes, so a page can still draw a saved layout whose list has since
 * been archived: parseLayout checks the shape alone, and tileProblem checks
 * one tile against the goal as it is now. A tile with a problem draws its
 * broken state, naming what is missing.
 *
 * Pure, so the refusals are tested without a database. The reads and the
 * write are in lib/goals/dashboard-store.ts.
 */

import { TRACKABLE_TYPES, liveFields, type CollectionField, type FieldType } from '@/lib/goals/collections';

/** Every kind of tile, in the order a picker offers them. Kept in step with goals.dashboard_problem. */
export const TILE_TYPES = ['number', 'countdown', 'chart', 'table', 'rooms', 'slots', 'tracker', 'grid'] as const;
export type TileType = (typeof TILE_TYPES)[number];

/** What each type is called to a person, in a picker or an error. */
export const TILE_TYPE_LABELS: Record<TileType, string> = {
  number: 'Number',
  countdown: 'Countdown',
  chart: 'Chart',
  table: 'Table',
  rooms: 'Parts',
  slots: 'Slots',
  tracker: 'Tracker',
  grid: 'Checklist grid',
};

export const TILES_MAX = 24;
export const TITLE_MAX = 120;
export const TILE_FIELDS_MAX = 12;
export const TRACKER_STEPS_MAX = 30;
export const SLOTS_MAX = 50;

export const CHART_STYLES = ['line', 'bar'] as const;
export type ChartStyle = (typeof CHART_STYLES)[number];

/**
 * A big number: a metric's latest period, or a list's rows. With `field` (a
 * number, money or percent field) it is the sum of that field over the
 * list's rows; without, how many rows the list has.
 */
export type NumberTile = { type: 'number'; title?: string; metric?: string; list?: string; field?: string };

/** Days until a date: a step's due date, or the soonest future value of a list's date field. */
export type CountdownTile = { type: 'countdown'; title?: string; step?: string; list?: string; field?: string };

/** A line or bar chart of a metric's periods, or of a tracked field's readings. */
export type ChartTile = {
  type: 'chart';
  title?: string;
  style: ChartStyle;
  metric?: string;
  list?: string;
  field?: string;
};

/** A table of one of the goal's lists, with the named columns or all of them. */
export type TableTile = { type: 'table'; title?: string; list: string; fields?: string[] };

/** A card per part, with a ring and its next step: the steps directly under `parent`, or under the goal. */
export type RoomsTile = { type: 'rooms'; title?: string; parent?: string };

/** A row of `count` slots that fill from a list's rows; with `field` (yes/no), only the rows where it is yes. */
export type SlotsTile = { type: 'slots'; title?: string; list: string; count: number; field?: string };

/** An ordered tracker of checkpoints: the named steps in order, or the steps under `parent`. */
export type TrackerTile = { type: 'tracker'; title?: string; steps?: string[]; parent?: string };

/** A grid of a list's rows by the named columns, yes/no fields drawn as checkboxes. */
export type GridTile = { type: 'grid'; title?: string; list: string; fields: string[] };

export type Tile =
  | NumberTile
  | CountdownTile
  | ChartTile
  | TableTile
  | RoomsTile
  | SlotsTile
  | TrackerTile
  | GridTile;

/** What a tile may read on the goal, as the goal is now. */
export type DashboardContext = {
  /** The goal's own live lists. */
  lists: ReadonlyArray<{ id: string; name: string; fields: CollectionField[] }>;
  /** The goal's live metrics. */
  metrics: ReadonlyArray<{ id: string; name: string }>;
  /** Every live step under the goal, at any depth. */
  stepIds: ReadonlySet<string>;
};

export type LayoutCheck =
  | { ok: true; tiles: Tile[] }
  /** `tile` is the position of the tile at fault from 0, or null when the fault is the whole layout. */
  | { ok: false; tile: number | null; error: string };

const ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const FIELD_KEY = /^[a-z][a-z0-9_]{0,39}$/;

/** The keys each type may carry besides `type` and `title`. */
const KEYS: Record<TileType, readonly string[]> = {
  number: ['metric', 'list', 'field'],
  countdown: ['step', 'list', 'field'],
  chart: ['style', 'metric', 'list', 'field'],
  table: ['list', 'fields'],
  rooms: ['parent'],
  slots: ['list', 'count', 'field'],
  tracker: ['steps', 'parent'],
  grid: ['list', 'fields'],
};

/** "Tile 3 (table)": how an error names a tile, counting from 1. */
export function tileLabel(index: number, type?: string): string {
  const known = (TILE_TYPES as readonly string[]).includes(type ?? '');
  return known ? `Tile ${index + 1} (${TILE_TYPE_LABELS[type as TileType].toLowerCase()})` : `Tile ${index + 1}`;
}

type Shape<T> = { ok: true; value: T } | { ok: false; error: string };

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

function idOf(raw: Record<string, unknown>, key: string, what: string): Shape<string | undefined> {
  const value = raw[key];
  if (value === undefined || value === null) return { ok: true, value: undefined };
  if (typeof value !== 'string' || !ID_PATTERN.test(value)) return { ok: false, error: `${what} is not an id` };
  return { ok: true, value: value.toLowerCase() };
}

function fieldOf(raw: Record<string, unknown>): Shape<string | undefined> {
  const value = raw.field;
  if (value === undefined || value === null) return { ok: true, value: undefined };
  if (typeof value !== 'string' || !FIELD_KEY.test(value)) return { ok: false, error: 'the field is not a field key' };
  return { ok: true, value };
}

function fieldsOf(raw: Record<string, unknown>, required: boolean): Shape<string[] | undefined> {
  const value = raw.fields;
  if (value === undefined || value === null) {
    return required ? { ok: false, error: 'it names no fields' } : { ok: true, value: undefined };
  }
  if (!Array.isArray(value)) return { ok: false, error: 'fields is not a list of field keys' };
  if (value.length === 0) return required ? { ok: false, error: 'it names no fields' } : { ok: true, value: undefined };
  if (value.length > TILE_FIELDS_MAX) return { ok: false, error: `it names ${value.length} fields, and a tile shows at most ${TILE_FIELDS_MAX}` };
  for (const key of value) {
    if (typeof key !== 'string' || !FIELD_KEY.test(key)) return { ok: false, error: 'fields is not a list of field keys' };
  }
  if (new Set(value).size !== value.length) return { ok: false, error: 'it names a field twice' };
  return { ok: true, value: value as string[] };
}

/** One tile's shape, without the goal. */
function parseTile(raw: unknown): Shape<Tile> {
  if (!isRecord(raw)) return { ok: false, error: 'it is not a tile' };
  const type = raw.type;
  if (typeof type !== 'string') return { ok: false, error: 'it has no type' };
  if (!(TILE_TYPES as readonly string[]).includes(type)) {
    return { ok: false, error: `"${type.slice(0, 40)}" is not a tile type (${TILE_TYPES.join(', ')})` };
  }
  const kind = type as TileType;
  const allowed = new Set(['type', 'title', ...KEYS[kind]]);
  const stray = Object.keys(raw).find((key) => !allowed.has(key));
  if (stray) return { ok: false, error: `it has "${stray.slice(0, 40)}", which a ${kind} tile does not use` };

  let title: string | undefined;
  if (raw.title !== undefined && raw.title !== null) {
    if (typeof raw.title !== 'string') return { ok: false, error: 'the title is not text' };
    title = raw.title.trim() || undefined;
    if (title && title.length > TITLE_MAX) return { ok: false, error: `the title is over ${TITLE_MAX} characters` };
  }
  const base = title ? { title } : {};

  const list = idOf(raw, 'list', 'the list');
  if (!list.ok) return list;
  const field = fieldOf(raw);
  if (!field.ok) return field;

  switch (kind) {
    case 'number': {
      const metric = idOf(raw, 'metric', 'the metric');
      if (!metric.ok) return metric;
      const either = oneOf(metric.value, list.value, 'a metric', 'a list');
      if (either) return either;
      if (field.value && !list.value) return { ok: false, error: 'a field goes with a list' };
      return { ok: true, value: { type: kind, ...base, ...pick({ metric: metric.value, list: list.value, field: field.value }) } };
    }
    case 'countdown': {
      const step = idOf(raw, 'step', 'the step');
      if (!step.ok) return step;
      const either = oneOf(step.value, list.value, 'a step', 'a list');
      if (either) return either;
      if (list.value && !field.value) return { ok: false, error: 'it needs the date field of the list' };
      if (field.value && !list.value) return { ok: false, error: 'a field goes with a list' };
      return { ok: true, value: { type: kind, ...base, ...pick({ step: step.value, list: list.value, field: field.value }) } };
    }
    case 'chart': {
      const style = raw.style;
      if (typeof style !== 'string' || !(CHART_STYLES as readonly string[]).includes(style)) {
        return { ok: false, error: 'its style is neither line nor bar' };
      }
      const metric = idOf(raw, 'metric', 'the metric');
      if (!metric.ok) return metric;
      const either = oneOf(metric.value, list.value, 'a metric', 'a list');
      if (either) return either;
      if (list.value && !field.value) return { ok: false, error: 'it needs the tracked field of the list' };
      if (field.value && !list.value) return { ok: false, error: 'a field goes with a list' };
      return {
        ok: true,
        value: { type: kind, ...base, style: style as ChartStyle, ...pick({ metric: metric.value, list: list.value, field: field.value }) },
      };
    }
    case 'table':
    case 'grid': {
      if (!list.value) return { ok: false, error: 'it names no list' };
      const fields = fieldsOf(raw, kind === 'grid');
      if (!fields.ok) return fields;
      if (kind === 'grid') return { ok: true, value: { type: kind, ...base, list: list.value, fields: fields.value ?? [] } };
      return { ok: true, value: { type: kind, ...base, list: list.value, ...pick({ fields: fields.value }) } };
    }
    case 'rooms': {
      const parent = idOf(raw, 'parent', 'the parent step');
      if (!parent.ok) return parent;
      return { ok: true, value: { type: kind, ...base, ...pick({ parent: parent.value }) } };
    }
    case 'slots': {
      if (!list.value) return { ok: false, error: 'it names no list' };
      const count = raw.count;
      if (typeof count !== 'number' || !Number.isInteger(count) || count < 1 || count > SLOTS_MAX) {
        return { ok: false, error: `its count is not a whole number from 1 to ${SLOTS_MAX}` };
      }
      return { ok: true, value: { type: kind, ...base, list: list.value, count, ...pick({ field: field.value }) } };
    }
    case 'tracker': {
      const parent = idOf(raw, 'parent', 'the parent step');
      if (!parent.ok) return parent;
      const rawSteps = raw.steps;
      let steps: string[] | undefined;
      if (rawSteps !== undefined && rawSteps !== null) {
        if (!Array.isArray(rawSteps) || rawSteps.some((s) => typeof s !== 'string' || !ID_PATTERN.test(s))) {
          return { ok: false, error: 'steps is not a list of step ids' };
        }
        if (rawSteps.length > TRACKER_STEPS_MAX) {
          return { ok: false, error: `it names ${rawSteps.length} steps, and a tracker shows at most ${TRACKER_STEPS_MAX}` };
        }
        steps = (rawSteps as string[]).map((s) => s.toLowerCase());
        if (new Set(steps).size !== steps.length) return { ok: false, error: 'it names a step twice' };
        if (steps.length === 0) steps = undefined;
      }
      const either = oneOf(steps, parent.value, 'a list of steps', 'a parent step');
      if (either) return either;
      return { ok: true, value: { type: kind, ...base, ...pick({ steps, parent: parent.value }) } };
    }
  }
}

/** Exactly one of two sources: null when it holds, the refusal when neither or both is named. */
function oneOf(a: unknown, b: unknown, aName: string, bName: string): { ok: false; error: string } | null {
  if (a && b) return { ok: false, error: `it names ${aName} and ${bName}, and reads only one` };
  if (!a && !b) return { ok: false, error: `it needs ${aName} or ${bName}` };
  return null;
}

/** The keys whose value is set, so a tile stores no undefined. */
function pick<T extends Record<string, unknown>>(values: T): Partial<T> {
  return Object.fromEntries(Object.entries(values).filter(([, v]) => v !== undefined)) as Partial<T>;
}

/** A layout's shape, without the goal. Null clears the dashboard and parses as no tiles. */
export function parseLayout(raw: unknown): LayoutCheck {
  if (raw === null || raw === undefined) return { ok: true, tiles: [] };
  if (!Array.isArray(raw)) return { ok: false, tile: null, error: 'The layout is not a list of tiles.' };
  if (raw.length > TILES_MAX) {
    return { ok: false, tile: null, error: `The layout has ${raw.length} tiles, and a goal holds at most ${TILES_MAX}.` };
  }
  const tiles: Tile[] = [];
  for (const [index, entry] of raw.entries()) {
    const parsed = parseTile(entry);
    if (!parsed.ok) {
      const type = isRecord(entry) && typeof entry.type === 'string' ? entry.type : undefined;
      return { ok: false, tile: index, error: `${tileLabel(index, type)}: ${parsed.error}.` };
    }
    tiles.push(parsed.value);
  }
  return { ok: true, tiles };
}

const NUMERIC: ReadonlySet<FieldType> = TRACKABLE_TYPES;

/**
 * What is wrong with one parsed tile on the goal as it is now, or null. Names
 * the list, metric, step or field that is missing, for the refusal on save
 * and for the tile's broken state on the page.
 */
export function tileProblem(tile: Tile, context: DashboardContext): string | null {
  const list = 'list' in tile && tile.list ? context.lists.find((l) => l.id === tile.list) : undefined;
  if ('list' in tile && tile.list && !list) return 'the list it reads is not on this goal';
  const live = list ? liveFields(list.fields) : [];
  const field = (key: string) => live.find((f) => f.key === key);
  const missing = (key: string) => `the list ${list?.name} has no field "${key}"`;

  if ('metric' in tile && tile.metric && !context.metrics.some((m) => m.id === tile.metric)) {
    return 'the metric it reads is not on this goal';
  }
  for (const key of ['step', 'parent'] as const) {
    const id = (tile as Record<string, unknown>)[key];
    if (typeof id === 'string' && !context.stepIds.has(id)) {
      return key === 'step' ? 'the step it counts down to is not on this goal' : 'the parent step is not on this goal';
    }
  }

  switch (tile.type) {
    case 'number': {
      if (!tile.field) return null;
      const f = field(tile.field);
      if (!f) return missing(tile.field);
      return NUMERIC.has(f.type) ? null : `${f.label} is not a number, money or percent field, so it cannot be added up`;
    }
    case 'countdown': {
      if (!tile.field) return null;
      const f = field(tile.field);
      if (!f) return missing(tile.field);
      return f.type === 'date' ? null : `${f.label} is not a date field`;
    }
    case 'chart': {
      if (!tile.field) return null;
      const f = field(tile.field);
      if (!f) return missing(tile.field);
      return NUMERIC.has(f.type) && f.tracked ? null : `${f.label} is not a tracked number, so it has no readings to chart`;
    }
    case 'table':
    case 'grid': {
      for (const key of tile.fields ?? []) {
        if (!field(key)) return missing(key);
      }
      return null;
    }
    case 'slots': {
      if (!tile.field) return null;
      const f = field(tile.field);
      if (!f) return missing(tile.field);
      return f.type === 'yes_no' ? null : `${f.label} is not a yes/no field`;
    }
    case 'tracker': {
      const away = (tile.steps ?? []).findIndex((id) => !context.stepIds.has(id));
      return away === -1 ? null : `step ${away + 1} of the tracker is not on this goal`;
    }
    case 'rooms':
      return null;
  }
}

/** The whole check every writer saves through: the shape, then each tile against the goal. */
export function checkLayout(raw: unknown, context: DashboardContext): LayoutCheck {
  const parsed = parseLayout(raw);
  if (!parsed.ok) return parsed;
  for (const [index, tile] of parsed.tiles.entries()) {
    const problem = tileProblem(tile, context);
    if (problem) return { ok: false, tile: index, error: `${tileLabel(index, tile.type)}: ${problem}.` };
  }
  return parsed;
}
