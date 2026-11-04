/**
 * What each of a goal's dashboard tiles shows (plan #2778.2): a saved tile
 * (lib/goals/dashboard.ts) and the goal's data, turned into the view the
 * Dashboard tab draws. Pure, so the gallery draws its fixtures through the
 * same code the page draws real rows through, and the sums, dates and series
 * are tested without a database. The reads are in lib/goals/dashboard-store.ts.
 *
 * Plan #2778.2 built the number, countdown, chart and table tiles; plan
 * #2778.3 the parts (a card per step that has steps of its own, with a ring
 * and its next step), slots, tracker and grid tiles. Counts of steps leave
 * out proposed and dropped ones; counts of rows leave out drafts.
 *
 * Every view is in one of three states. Ready: it has something to show.
 * Empty: its source is there but holds nothing yet, and `empty` says what the
 * tile will show once it does. Broken: `problem` names the list, metric, step
 * or field that is missing, and there is no body.
 */

import { liveFields, type CollectionField, type RecordValues } from '@/lib/goals/collections';
import { TILE_TYPE_LABELS, type Tile, type TileType } from '@/lib/goals/dashboard';
import { formatDay } from '@/lib/goals/dates';
import { nameFieldOf } from '@/lib/goals/goal-lists';
import { displayValue } from '@/lib/goals/information';
import {
  currentLabel,
  metricChart,
  metricSummary,
  nothingCounted,
  periodLabel,
  targetLine,
  type MetricChart,
} from '@/lib/goals/metric-chart';
import type { Metric, MetricPeriod, PeriodCount } from '@/lib/goals/metrics';
import { formatNumber } from '@/lib/money';

/** One of the goal's lists, with its live records. */
export type TileList = {
  id: string;
  name: string;
  fields: CollectionField[];
  records: { id: string; data: RecordValues; draft: boolean }[];
};

/** A dated value of a tracked field on one record (goals.readings). */
export type TileReading = { recordId: string; field: string; value: number; readOn: string };

/**
 * A live step under the goal: what a countdown counts to, a part's steps, a
 * tracker's checkpoints. `parentId` is the goal's id for a top-level step.
 */
export type TileStep = {
  id: string;
  title: string;
  dueOn: string | null;
  status: string;
  closedOn: string | null;
  parentId: string | null;
  position: number;
};

/** Everything the tiles read on one goal. */
export type DashboardData = {
  /** The goal's id: a parts tile with no parent reads its top-level steps. */
  goalId: string;
  /** Today in the account's zone. */
  today: string;
  lists: readonly TileList[];
  metrics: readonly (Metric & { counts: PeriodCount[] })[];
  steps: readonly TileStep[];
  readings: readonly TileReading[];
  /**
   * The names of lists a tile names that are no longer on the goal (archived
   * since), so its broken state can say which list it was.
   */
  goneLists?: Readonly<Record<string, string>>;
};

/**
 * What a tile's + button opens. A row: the fields to fill on a new row of
 * the list. A reading: each row of the list with its value of a tracked
 * field, to type over; each one changed is kept as a dated reading.
 */
export type QuickAdd =
  | { kind: 'row'; label: string; listId: string; listName: string; fields: CollectionField[] }
  | {
      kind: 'reading';
      label: string;
      listId: string;
      listName: string;
      field: CollectionField;
      /** What names a row in the form: the list's name field, such as "Loan". */
      rowLabel: string;
      /** Each row, its value as shown and as its input starts out. */
      rows: { id: string; name: string; value: string; input: string }[];
    };

/** One point of a line, or one bar: a day or a period and its value. */
export type SeriesPoint = { on: string; value: number; label: string };

export type NumberBody = { type: 'number'; value: string; caption: string };
export type CountdownBody = {
  type: 'countdown';
  /** Days from today; 0 is today. */
  days: number;
  date: string;
  caption: string;
};
export type ChartBody = {
  type: 'chart';
  style: 'line' | 'bar';
  /** A metric's periods, drawn as the Overview's bars are. */
  bars: MetricChart | null;
  /** A line, or bars of a tracked field's readings. */
  points: SeriesPoint[];
  /** The field whose values are drawn, for writing them as money or a percent; null for a count. */
  field: CollectionField | null;
  summary: string;
  /** The target's label, or null. */
  target: { value: number; label: string } | null;
  /** The period's word for a metric's bars, for the table a screen reader reads. */
  period: MetricPeriod | null;
};
export type TableBody = {
  type: 'table';
  columns: CollectionField[];
  rows: { id: string; data: RecordValues }[];
  /** Rows on the list beyond the ones shown. */
  more: number;
};

/** One open step of a part, and the step it sits under when that is not the part itself. */
export type PartStep = { id: string; title: string; under: string | null; dueOn: string | null; blocked: boolean };

/** A part's card: its steps done out of all, when it last moved, and its open steps in plan order. */
export type Part = {
  id: string;
  title: string;
  done: number;
  total: number;
  /** The day its latest step closed, or null when none has. */
  lastOn: string | null;
  /** Its open steps, the first being its next one; at most PART_STEPS_MAX. */
  open: PartStep[];
  /** Open steps beyond the ones listed. */
  moreOpen: number;
};

export type RoomsBody = { type: 'rooms'; parts: Part[]; done: number; total: number };

export type SlotsBody = {
  type: 'slots';
  count: number;
  /** The rows that fill a slot, in the list's order. */
  filled: { id: string; name: string }[];
  caption: string;
};

export type Checkpoint = {
  id: string;
  title: string;
  /** Done; the first not done, which is what is next; or one after it. */
  state: 'done' | 'now' | 'later';
  dueOn: string | null;
  closedOn: string | null;
};

export type TrackerBody = { type: 'tracker'; points: Checkpoint[]; done: number };

export type GridBody = {
  type: 'grid';
  /** The column that names each row, or null when the list has none. */
  name: CollectionField | null;
  columns: CollectionField[];
  rows: { id: string; name: string; data: RecordValues }[];
  /** Rows on the list beyond the ones shown. */
  more: number;
  /** For each yes/no column, how many of all the rows are yes. */
  totals: Record<string, number>;
  /** All the rows counted, for "3 of 8". */
  of: number;
};

export type TileBody = NumberBody | CountdownBody | ChartBody | TableBody | RoomsBody | SlotsBody | TrackerBody | GridBody;

export type TileView = {
  /** Its place in the layout, from 0: what Move and Remove name. */
  index: number;
  type: TileType;
  title: string;
  /** What is missing, for the broken state. */
  problem: string | null;
  /** What the tile will show, when its source holds nothing yet. */
  empty: string | null;
  body: TileBody | null;
  add: QuickAdd | null;
};

/** The most rows a table tile shows before "and N more". */
export const TABLE_ROWS_MAX = 8;
/** The columns a table tile shows when it names none. */
export const TABLE_COLUMNS_DEFAULT = 5;
/** The fields a new row's form asks for at most. */
export const ADD_FIELDS_MAX = 4;
/** The most readings a chart of a tracked field draws. */
export const SERIES_MAX = 24;

const DAY_MS = 86_400_000;

/** Whole days from `from` to `to`, both YYYY-MM-DD. */
export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS);
}

/** "Today", "Tomorrow", "45 days"; a step's date gone by is "3 days late". */
export function countdownWords(days: number): string {
  if (days === 0) return 'Today';
  if (days === 1) return 'Tomorrow';
  if (days < 0) return `${formatNumber(-days)} ${days === -1 ? 'day' : 'days'} late`;
  return `${formatNumber(days)} days`;
}

/** A row's name, or "Row 3" when its list has no name field or the row none. */
export function rowName(fields: CollectionField[], data: RecordValues, position: number): string {
  const field = nameFieldOf(fields);
  const value = field ? data[field.key] : null;
  return typeof value === 'string' && value.trim() ? value.trim() : `Row ${position + 1}`;
}

/** The rows a tile counts: drafts found for you are left out until confirmed. */
const counted = (list: TileList) => list.records.filter((r) => !r.draft);

/** A value of a field as the page writes it: money with its sign, a percent with its mark, a count plain. */
export function formatValue(field: CollectionField | null, value: number): string {
  const shown = (field ? displayValue(field, value) : '') || formatNumber(value);
  // A whole amount of money reads without its cents: "$127,200", not "$127,200.00".
  return field?.type === 'money' && Number.isInteger(value) ? shown.replace(/\.00$/, '') : shown;
}

function formatAs(field: CollectionField | null): (value: number) => string {
  return (value) => formatValue(field, value);
}

/** Fields that suit a one-line form: no long text, picture, place or link to another row. */
const FORMABLE = new Set(['text', 'number', 'money', 'percent', 'date', 'day_of_month', 'yes_no', 'choice', 'link']);

/** The fields a new row's form asks for: the name first, then the ones the tile reads. */
function rowFields(list: TileList, want: readonly string[]): CollectionField[] {
  const live = liveFields(list.fields).filter((f) => FORMABLE.has(f.type));
  const name = nameFieldOf(list.fields);
  const keys = [...(name ? [name.key] : []), ...want];
  const picked = [...new Set(keys)]
    .map((key) => live.find((f) => f.key === key))
    .filter((f): f is CollectionField => f !== undefined);
  return (picked.length > 0 ? picked : live).slice(0, ADD_FIELDS_MAX);
}

function addRow(list: TileList, want: readonly string[]): QuickAdd {
  return { kind: 'row', label: `Add to ${list.name}`, listId: list.id, listName: list.name, fields: rowFields(list, want) };
}

function addReading(list: TileList, field: CollectionField): QuickAdd | null {
  const rows = counted(list).map((record, position) => ({
    id: record.id,
    name: rowName(list.fields, record.data, position),
    value: displayValue(field, record.data[field.key]),
    input: typeof record.data[field.key] === 'number' ? formatValue(field, record.data[field.key] as number) : '',
  }));
  // A tracked field with no rows takes a row first, which writes its first reading.
  if (rows.length === 0) return addRow(list, [field.key]);
  const label = `Log ${rows.length > 1 ? plural(field.label.toLowerCase()) : field.label.toLowerCase()}`;
  const rowLabel = nameFieldOf(list.fields)?.label ?? list.name;
  return { kind: 'reading', label, listId: list.id, listName: list.name, field, rowLabel, rows };
}

/** The add for a metric: a row on its list for a list metric, nothing for steps, files or hours. */
function addForMetric(metric: Metric, data: DashboardData): QuickAdd | null {
  if (metric.source !== 'list' || !metric.collectionId) return null;
  const list = data.lists.find((l) => l.id === metric.collectionId);
  return list ? addRow(list, metric.dateField ? [metric.dateField] : []) : null;
}

/** "balances" from "balance": enough for the add line's label. */
function plural(word: string): string {
  return /s$/.test(word) ? word : `${word}s`;
}

/**
 * What an empty metric says: that nothing is counted yet, then what one more
 * will do, in the person's words rather than the list's field names. `shows`
 * is how a chart draws each period.
 */
function metricReads(metric: Metric, data: DashboardData, shows: string): string {
  const each = `Each ${metric.period} ${shows}.`;
  if (metric.source === 'steps') return `No steps closed yet. ${each}`;
  if (metric.source === 'files') return `No files from Dash yet. ${each}`;
  if (metric.source === 'hours') return `No hours logged yet. Write "applied 2h" in the capture box. ${each}`;
  const list = data.lists.find((l) => l.id === metric.collectionId);
  return `Nothing in ${list?.name ?? 'its list'} yet. ${each}`;
}

/**
 * A tracked field's readings across a list's rows, one point a day. With
 * one row it is that row's series; with several, each day's point is the sum
 * of every row's latest reading on or before that day, so four loans' balances
 * read as the total owed. A row counts from its first reading on.
 */
export function combinedSeries(
  list: TileList,
  field: string,
  readings: readonly TileReading[],
): { on: string; value: number }[] {
  const rows = new Set(counted(list).map((r) => r.id));
  const mine = readings
    .filter((r) => r.field === field && rows.has(r.recordId))
    .sort((a, b) => (a.readOn < b.readOn ? -1 : a.readOn > b.readOn ? 1 : 0));
  const latest = new Map<string, number>();
  const points: { on: string; value: number }[] = [];
  for (const reading of mine) {
    latest.set(reading.recordId, reading.value);
    const value = Math.round([...latest.values()].reduce((a, b) => a + b, 0) * 100) / 100;
    const last = points[points.length - 1];
    if (last && last.on === reading.readOn) last.value = value;
    else points.push({ on: reading.readOn, value });
  }
  return points.slice(-SERIES_MAX);
}

type Built = Pick<TileView, 'title' | 'empty' | 'body' | 'add'>;

function numberTile(tile: Extract<Tile, { type: 'number' }>, data: DashboardData): Built {
  if (tile.metric) {
    const metric = data.metrics.find((m) => m.id === tile.metric)!;
    const add = addForMetric(metric, data);
    if (nothingCounted(metric.counts)) {
      return { title: tile.title ?? metric.name, empty: metricReads(metric, data, 'counts toward the number'), body: null, add };
    }
    const latest = metric.counts[metric.counts.length - 1]?.count ?? 0;
    const aim = metric.target === null ? '' : ` · ${targetLine(metric.target, metric.period, metric.targetHigh ?? null).toLowerCase()}`;
    return {
      title: tile.title ?? metric.name,
      empty: null,
      body: { type: 'number', value: formatNumber(latest), caption: `${currentLabel(metric.period)}${aim}` },
      add,
    };
  }
  const list = data.lists.find((l) => l.id === tile.list)!;
  const rows = counted(list);
  if (!tile.field) {
    const add = addRow(list, []);
    if (rows.length === 0) {
      return { title: tile.title ?? list.name, empty: `Nothing in ${list.name} yet. Each one you add counts here.`, body: null, add };
    }
    return {
      title: tile.title ?? list.name,
      empty: null,
      body: { type: 'number', value: formatNumber(rows.length), caption: `In ${list.name}` },
      add,
    };
  }
  const field = liveFields(list.fields).find((f) => f.key === tile.field)!;
  const add = field.tracked ? addReading(list, field) : addRow(list, [field.key]);
  const values = rows.map((r) => r.data[field.key]).filter((v): v is number => typeof v === 'number');
  const title = tile.title ?? field.label;
  if (values.length === 0) {
    return { title, empty: `No ${field.label.toLowerCase()} in ${list.name} yet. Each one you add counts toward the total.`, body: null, add };
  }
  const sum = Math.round(values.reduce((a, b) => a + b, 0) * 100) / 100;
  const over = values.length === 1 ? `From ${list.name}` : `${values.length} in ${list.name}, added up`;
  return { title, empty: null, body: { type: 'number', value: formatAs(field)(sum), caption: over }, add };
}

function countdownTile(tile: Extract<Tile, { type: 'countdown' }>, data: DashboardData): Built {
  if (tile.step) {
    const step = data.steps.find((s) => s.id === tile.step)!;
    const title = tile.title ?? step.title;
    if (step.status === 'done' || step.status === 'dropped') {
      const when = step.closedOn ? ` on ${formatDay(step.closedOn)}` : '';
      return { title, empty: `${step.title} was closed${when}. Nothing is left to count down to.`, body: null, add: null };
    }
    if (!step.dueOn) {
      // Untitled, the tile is named by the step, so the line does not name it again.
      const which = tile.title ? `${step.title} has` : 'It has';
      return { title, empty: `${which} no date yet. Give it one and this counts down to it.`, body: null, add: null };
    }
    const days = daysBetween(data.today, step.dueOn);
    const caption = `${formatDay(step.dueOn)} · ${step.title}`;
    return { title, empty: null, body: { type: 'countdown', days, date: step.dueOn, caption }, add: null };
  }
  const list = data.lists.find((l) => l.id === tile.list)!;
  const field = liveFields(list.fields).find((f) => f.key === tile.field)!;
  const title = tile.title ?? `Next ${field.label.toLowerCase()}`;
  const ahead = counted(list)
    .map((record, position) => ({ on: record.data[field.key], name: rowName(list.fields, record.data, position) }))
    .filter((d): d is { on: string; name: string } => typeof d.on === 'string' && d.on >= data.today)
    .sort((a, b) => (a.on < b.on ? -1 : a.on > b.on ? 1 : 0));
  const add = addRow(list, [field.key]);
  if (ahead.length === 0) {
    return { title, empty: `No ${field.label.toLowerCase()} ahead in ${list.name}. Add one and this counts down to it.`, body: null, add };
  }
  const [next, after] = ahead;
  const then = after && after.on !== next.on ? `, then ${formatDay(after.on)}` : '';
  const same = ahead.filter((d) => d.on === next.on).length;
  const who = same > 1 ? `${next.name} and ${same - 1} more` : next.name;
  return {
    title,
    empty: null,
    body: { type: 'countdown', days: daysBetween(data.today, next.on), date: next.on, caption: `${formatDay(next.on)} · ${who}${then}` },
    add,
  };
}

function chartTile(tile: Extract<Tile, { type: 'chart' }>, data: DashboardData): Built {
  if (tile.metric) {
    const metric = data.metrics.find((m) => m.id === tile.metric)!;
    const add = addForMetric(metric, data);
    const title = tile.title ?? metric.name;
    const chart = metricChart(metric.counts, metric.period, metric.target, metric.targetHigh ?? null);
    if (!chart || nothingCounted(metric.counts)) return { title, empty: metricReads(metric, data, tile.style === 'bar' ? 'shows here as a bar' : 'adds a point to the line'), body: null, add };
    const target =
      metric.target === null ? null : { value: metric.target, label: targetLine(metric.target, metric.period, metric.targetHigh ?? null) };
    return {
      title,
      empty: null,
      body: {
        type: 'chart',
        style: tile.style,
        bars: chart,
        points: chart.bars.map((bar) => ({ on: bar.startsOn, value: bar.count, label: periodLabel(metric.period, bar.startsOn) })),
        field: null,
        summary: metricSummary(chart, metric.period),
        target,
        period: metric.period,
      },
      add,
    };
  }
  const list = data.lists.find((l) => l.id === tile.list)!;
  const field = liveFields(list.fields).find((f) => f.key === tile.field)!;
  const title = tile.title ?? field.label;
  const add = addReading(list, field);
  const series = combinedSeries(list, field.key, data.readings);
  const rows = counted(list).length;
  if (series.length === 0) {
    const mark = tile.style === 'bar' ? 'a bar' : 'a point on the line';
    // With no rows yet the add starts a row, so the line says that is what is missing.
    const missing = rows === 0 ? `Nothing in ${list.name} yet` : `No ${plural(field.label.toLowerCase())} logged yet`;
    return { title, empty: `${missing}. Each ${field.label.toLowerCase()} you log draws here as ${mark}.`, body: null, add };
  }
  const format = formatAs(field);
  const first = series[0];
  const last = series[series.length - 1];
  const summary =
    series.length === 1
      ? `${format(last.value)} on ${formatDay(last.on)}`
      : `${format(last.value)} on ${formatDay(last.on)}, from ${format(first.value)} on ${formatDay(first.on, true)}`;
  return {
    title,
    empty: null,
    body: {
      type: 'chart',
      style: tile.style,
      bars: null,
      points: series.map((p) => ({ ...p, label: formatDay(p.on, true) })),
      field,
      summary: rows > 1 ? `${summary} · ${rows} in ${list.name}, added up` : summary,
      target: null,
      period: null,
    },
    add,
  };
}

function tableTile(tile: Extract<Tile, { type: 'table' }>, data: DashboardData): Built {
  const list = data.lists.find((l) => l.id === tile.list)!;
  const live = liveFields(list.fields);
  const columns = tile.fields
    ? tile.fields.map((key) => live.find((f) => f.key === key)!).filter(Boolean)
    : live.filter((f) => f.type !== 'long_text' && f.type !== 'image').slice(0, TABLE_COLUMNS_DEFAULT);
  const rows = counted(list);
  const add = addRow(list, columns.map((c) => c.key));
  const title = tile.title ?? list.name;
  if (rows.length === 0) {
    return { title, empty: `Nothing in ${list.name} yet. What you add shows here.`, body: null, add };
  }
  return {
    title,
    empty: null,
    body: {
      type: 'table',
      columns,
      rows: rows.slice(0, TABLE_ROWS_MAX).map((r) => ({ id: r.id, data: r.data })),
      more: Math.max(0, rows.length - TABLE_ROWS_MAX),
    },
    add,
  };
}

/** The open steps a part's card lists when pressed, before "N more". */
export const PART_STEPS_MAX = 12;
/** The most rows a grid tile shows before "N more". */
export const GRID_ROWS_MAX = 12;

/** A step that counts: proposed ones wait on the person and dropped ones will not be done. */
const live = (step: TileStep) => step.status !== 'proposed' && step.status !== 'dropped';
const isOpen = (step: TileStep) => step.status === 'open' || step.status === 'blocked';

/** The live steps directly under `parentId`, in plan order. */
function childrenOf(data: DashboardData, parentId: string): TileStep[] {
  return data.steps
    .filter((s) => s.parentId === parentId && live(s))
    .sort((a, b) => a.position - b.position || a.title.localeCompare(b.title));
}

/** The steps under `parentId` with none of their own, depth first in plan order, each with the step it sits under. */
function leavesUnder(data: DashboardData, parentId: string): { step: TileStep; under: TileStep | null }[] {
  const out: { step: TileStep; under: TileStep | null }[] = [];
  const walk = (id: string, under: TileStep | null, seen: Set<string>) => {
    for (const child of childrenOf(data, id)) {
      if (seen.has(child.id)) continue;
      seen.add(child.id);
      if (childrenOf(data, child.id).length === 0) out.push({ step: child, under });
      else walk(child.id, child, seen);
    }
  };
  walk(parentId, null, new Set([parentId]));
  return out;
}

const stepTitle = (data: DashboardData, id: string) => data.steps.find((s) => s.id === id)?.title;

function roomsTile(tile: Extract<Tile, { type: 'rooms' }>, data: DashboardData): Built {
  const root = tile.parent ?? data.goalId;
  const title = tile.title ?? (tile.parent ? (stepTitle(data, tile.parent) ?? 'Parts') : 'Parts');
  // A part is a step with steps of its own; a lone step is not one.
  const parts: Part[] = childrenOf(data, root)
    .filter((step) => childrenOf(data, step.id).length > 0)
    .map((step) => {
      const leaves = leavesUnder(data, step.id);
      const done = leaves.filter((l) => l.step.status === 'done');
      const open = leaves.filter((l) => isOpen(l.step));
      const lastOn = done.reduce<string | null>((latest, l) => {
        const on = l.step.closedOn;
        return on && (!latest || on > latest) ? on : latest;
      }, null);
      return {
        id: step.id,
        title: step.title,
        done: done.length,
        total: leaves.length,
        lastOn,
        open: open.slice(0, PART_STEPS_MAX).map(({ step: s, under }) => ({
          id: s.id,
          title: s.title,
          under: under?.title ?? null,
          dueOn: s.dueOn,
          blocked: s.status === 'blocked',
        })),
        moreOpen: Math.max(0, open.length - PART_STEPS_MAX),
      };
    });
  if (parts.length === 0) {
    const where = tile.parent ? `Nothing under ${title}` : 'No step on this goal';
    return {
      title,
      empty: `${where} has steps of its own yet. Each one that does shows here as a card with its progress and next step.`,
      body: null,
      add: null,
    };
  }
  const done = parts.reduce((sum, p) => sum + p.done, 0);
  const total = parts.reduce((sum, p) => sum + p.total, 0);
  return { title, empty: null, body: { type: 'rooms', parts, done, total }, add: null };
}

/** "Ana, Ben, Cy and 2 more": the first names, then how many after. */
function namesLine(names: string[], shown = 3): string {
  if (names.length <= shown) {
    return names.length <= 1 ? (names[0] ?? '') : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
  }
  return `${names.slice(0, shown).join(', ')} and ${names.length - shown} more`;
}

function slotsTile(tile: Extract<Tile, { type: 'slots' }>, data: DashboardData): Built {
  const list = data.lists.find((l) => l.id === tile.list)!;
  const field = tile.field ? liveFields(list.fields).find((f) => f.key === tile.field)! : null;
  const title = tile.title ?? list.name;
  const add = addRow(list, field ? [field.key] : []);
  const filled = counted(list)
    .map((record, position) => ({ id: record.id, name: rowName(list.fields, record.data, position), yes: record.data[field?.key ?? ''] }))
    .filter((r) => !field || r.yes === true)
    .map(({ id, name }) => ({ id, name }));
  if (filled.length === 0) {
    const fills = field ? `Each row in ${list.name} marked ${field.label.toLowerCase()}` : `Each one you add to ${list.name}`;
    return { title, empty: `None of ${formatNumber(tile.count)} yet. ${fills} fills a slot.`, body: null, add };
  }
  const over = filled.length - tile.count;
  const names = namesLine(filled.map((f) => f.name));
  // When the list holds other than the slots, say so, so "2 of 8" does not read against a list of 7.
  const rows = counted(list).length;
  const aim = rows === tile.count ? '' : ` · ${formatNumber(tile.count)} aimed for, ${formatNumber(rows)} in ${list.name}`;
  const caption = over > 0 ? `${names} · ${formatNumber(over)} past the ${formatNumber(tile.count)} aimed for` : `${names}${aim}`;
  return { title, empty: null, body: { type: 'slots', count: tile.count, filled, caption }, add };
}

function trackerTile(tile: Extract<Tile, { type: 'tracker' }>, data: DashboardData): Built {
  const title = tile.title ?? (tile.parent ? (stepTitle(data, tile.parent) ?? 'Checkpoints') : 'Checkpoints');
  const steps = tile.steps
    ? tile.steps.map((id) => data.steps.find((s) => s.id === id)).filter((s): s is TileStep => s !== undefined && live(s))
    : childrenOf(data, tile.parent!);
  if (steps.length === 0) {
    return { title, empty: `No steps under ${title} yet. Each one added shows here as a checkpoint, in order.`, body: null, add: null };
  }
  let now = false;
  const points: Checkpoint[] = steps.map((s) => {
    let state: Checkpoint['state'] = 'done';
    if (s.status !== 'done') {
      state = now ? 'later' : 'now';
      now = true;
    }
    return { id: s.id, title: s.title, state, dueOn: s.dueOn, closedOn: s.closedOn };
  });
  const done = points.filter((p) => p.state === 'done').length;
  return { title, empty: null, body: { type: 'tracker', points, done }, add: null };
}

function gridTile(tile: Extract<Tile, { type: 'grid' }>, data: DashboardData): Built {
  const list = data.lists.find((l) => l.id === tile.list)!;
  const live = liveFields(list.fields);
  const name = nameFieldOf(list.fields);
  const columns = tile.fields
    .filter((key) => key !== name?.key)
    .map((key) => live.find((f) => f.key === key)!)
    .filter(Boolean);
  const rows = counted(list);
  const title = tile.title ?? list.name;
  const add = addRow(list, tile.fields);
  if (rows.length === 0) {
    return { title, empty: `Nothing in ${list.name} yet. Each row you add shows here with its marks.`, body: null, add };
  }
  const totals: Record<string, number> = {};
  for (const column of columns) {
    if (column.type === 'yes_no') totals[column.key] = rows.filter((r) => r.data[column.key] === true).length;
  }
  return {
    title,
    empty: null,
    body: {
      type: 'grid',
      name,
      columns,
      rows: rows.slice(0, GRID_ROWS_MAX).map((r, position) => ({ id: r.id, name: rowName(list.fields, r.data, position), data: r.data })),
      more: Math.max(0, rows.length - GRID_ROWS_MAX),
      totals,
      of: rows.length,
    },
    add,
  };
}

/** The types with a view. Every type has one since plan #2778.3. */
export const VIEWED_TYPES: ReadonlySet<TileType> = new Set(['number', 'countdown', 'chart', 'table', 'rooms', 'slots', 'tracker', 'grid']);

/**
 * One tile as the page draws it. `problem` is tileProblem's answer for the
 * goal as it is now; a tile with one is drawn broken, naming it, with no
 * body and no add.
 */
export function tileView(tile: Tile, index: number, problem: string | null, data: DashboardData): TileView {
  const fallback = tile.title ?? TILE_TYPE_LABELS[tile.type];
  const base = { index, type: tile.type, problem };
  if (problem) {
    return { ...base, problem: brokenLine(problem, tile, data), title: fallback, empty: null, body: null, add: null };
  }
  switch (tile.type) {
    case 'number':
      return { ...base, ...numberTile(tile, data) };
    case 'countdown':
      return { ...base, ...countdownTile(tile, data) };
    case 'chart':
      return { ...base, ...chartTile(tile, data) };
    case 'table':
      return { ...base, ...tableTile(tile, data) };
    case 'rooms':
      return { ...base, ...roomsTile(tile, data) };
    case 'slots':
      return { ...base, ...slotsTile(tile, data) };
    case 'tracker':
      return { ...base, ...trackerTile(tile, data) };
    case 'grid':
      return { ...base, ...gridTile(tile, data) };
  }
}

/**
 * The broken state's sentence, starting with a capital: what is missing,
 * naming the list when it has gone from the goal and its name is known.
 */
export function brokenLine(problem: string, tile?: Tile, data?: DashboardData): string {
  const gone = tile && 'list' in tile && tile.list ? data?.goneLists?.[tile.list] : undefined;
  const said = gone && problem === 'the list it reads is not on this goal' ? `the list ${gone} is no longer on this goal` : problem;
  return `${said.charAt(0).toUpperCase()}${said.slice(1)}.`;
}
