/**
 * What each of a goal's dashboard tiles shows (plan #2778.2): a saved tile
 * (lib/goals/dashboard.ts) and the goal's data, turned into the view the
 * Dashboard tab draws. Pure, so the gallery draws its fixtures through the
 * same code the page draws real rows through, and the sums, dates and series
 * are tested without a database. The reads are in lib/goals/dashboard-store.ts.
 *
 * This step builds the number, countdown, chart and table tiles. A type with
 * no view here yet (rooms, slots, tracker, grid; plan #2778.3) gives `body:
 * null` with no problem, and the page leaves it out.
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

/** A step a countdown can count to. */
export type TileStep = { id: string; title: string; dueOn: string | null; status: string; closedOn: string | null };

/** Everything the tiles read on one goal. */
export type DashboardData = {
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

export type TileBody = NumberBody | CountdownBody | ChartBody | TableBody;

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

/** The types this step draws; the rest come with plan #2778.3. */
export const VIEWED_TYPES: ReadonlySet<TileType> = new Set(['number', 'countdown', 'chart', 'table']);

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
    default:
      return { ...base, title: fallback, empty: null, body: null, add: null };
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
