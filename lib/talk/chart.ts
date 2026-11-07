import { formatMoney, formatNumber } from '@/lib/money';
import type { TalkToolCall } from './talk';

/**
 * A chart in Dash's reply (plan #1655; docs/UI-QUALITY-SPEC.md, Part 9 and
 * R11). When the person asks how something splits or changes, such as
 * spending by shop or applications by stage, Dash calls `show_chart` with the
 * figures its lookups returned, and the reply draws them as bars or a small
 * table under the answer.
 *
 * The chart is kept as that call's result in the turn's tool_calls
 * (core.conversation_turns), so a reopened conversation draws it again from
 * the turn alone. It is never written to a workspace page.
 *
 * Six kinds. A bar compares amounts that are parts of one question
 * (spend by shop); a table lists figures a length would mislead about, such
 * as days in each stage beside a count; columns show one amount over time,
 * oldest first, the last column the period asked about; a figure is the one
 * number a question asked for, set large. Columns and a figure can carry a
 * reference: the usual amount (an average of the months before) or a target
 * the person set, drawn as a line across the columns or as the change beside
 * the figure.
 *
 * A line or an area (plan #3050.2.1) shows up to four series over the same
 * labels, such as three stock indices over a week; a table can carry the same
 * several values a row, one column each, and sorts by any of them. A chart
 * with several series names them in `series`, and each row carries one value
 * per series in `values`, null where a series has none for that label (a
 * market closed for a holiday). Charts kept before then have no series and
 * draw as they did.
 *
 * Nothing here reads a database or the network, so the thread imports it.
 */

export const CHART_TOOL = 'show_chart';
export const CHART_KINDS = ['bar', 'table', 'columns', 'figure', 'line', 'area'] as const;
export type ChartKind = (typeof CHART_KINDS)[number];

/** The most rows a chart draws: a phone shows twelve bars without scrolling past the answer. */
export const MAX_CHART_ROWS = 12;
export const MAX_CHART_TITLE = 100;
/** Longer labels are cut at a word; a shop or stage name is rarely half this. */
export const MAX_CHART_LABEL = 60;
export const MAX_CHART_HEADING = 30;
export const MAX_CHART_UNIT = 20;
/** The most series a line, an area or a table carries: a fifth line on a phone is a tangle. */
export const MAX_CHART_SERIES = 4;
/** The most points a line or an area draws: a day each over two months. */
export const MAX_CHART_POINTS = 62;

/** The kinds that draw series over time: a line, or a line with the ground under it filled. */
export const TREND_KINDS = ['line', 'area'] as const;

/**
 * One row. With several series, `values` holds one value per series in the
 * order `series` names them, null where that series has none, and `value` is
 * the first series' value (0 when it has none) for the code that reads one.
 */
export type DashChartRow = { label: string; value: number; values?: (number | null)[] };

/** One of several series: its name, and its own unit when it differs from the chart's ("%"). */
export type DashChartSeries = { name: string; unit: string | null };

/** What a figure or columns are measured against: the usual amount, or a target. */
export type DashChartReference = { label: string; value: number };

export type DashChart = {
  kind: ChartKind;
  title: string;
  rows: DashChartRow[];
  /** ISO code when the values are money, in whole units (12.5 is $12.50). */
  currency: string | null;
  /** What a value counts when it is not money: "applications", "days". */
  unit: string | null;
  /** A table's two column headings; null for a bar, or to let the table name them. */
  columns: [string, string] | null;
  /** For columns or a figure: the usual amount or a target; null when none was given. */
  reference: DashChartReference | null;
  /**
   * The series a line, an area or a table draws, in order; null for one
   * series, whose values are the rows' `value`. Charts kept before plan
   * #3050.2.1 have no such field, which reads as null.
   */
  series: DashChartSeries[] | null;
};

function line(value: unknown): string {
  return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';
}

/** Cut at a word with an ellipsis, so a long label stays one line's worth. */
function cut(text: string, max: number): string {
  if (text.length <= max) return text;
  const head = text.slice(0, max - 1);
  const space = head.lastIndexOf(' ');
  return `${(space > max / 2 ? head.slice(0, space) : head).trimEnd()}…`;
}

/**
 * Checks a chart as the model sent it, or as a turn kept it, and returns it
 * in the shape the reply draws. The error is a sentence for the model, so it
 * can send the chart again within the limits.
 */
export function parseChart(input: unknown): { ok: true; chart: DashChart } | { ok: false; error: string } {
  const raw = input && typeof input === 'object' ? (input as Record<string, unknown>) : {};

  const kind = raw.kind;
  if (!(CHART_KINDS as readonly unknown[]).includes(kind)) {
    return { ok: false, error: 'kind must be "bar", "table", "columns", "figure", "line" or "area".' };
  }
  const chartKind = kind as ChartKind;

  const title = line(raw.title);
  if (!title) return { ok: false, error: 'Give the chart a title that says what it shows.' };
  if (title.length > MAX_CHART_TITLE) {
    return { ok: false, error: `The title is ${title.length} characters; the most is ${MAX_CHART_TITLE}.` };
  }

  const trend = isTrend(chartKind);
  const series = parseSeries(raw.series);
  if (typeof series === 'string') return { ok: false, error: series };
  if (series && chartKind !== 'table' && !trend) {
    return { ok: false, error: 'Only a line, an area or a table takes several series.' };
  }

  if (!Array.isArray(raw.rows) || raw.rows.length === 0) {
    return { ok: false, error: 'A chart needs at least one row.' };
  }
  if (trend && raw.rows.length > MAX_CHART_POINTS) {
    return {
      ok: false,
      error: `That is ${raw.rows.length} points; the most is ${MAX_CHART_POINTS}. Take one a week instead of one a day.`,
    };
  }
  if (!trend && raw.rows.length > MAX_CHART_ROWS) {
    return {
      ok: false,
      error: `That is ${raw.rows.length} rows; the most is ${MAX_CHART_ROWS}. Keep the ${MAX_CHART_ROWS - 1} largest and add the rest together as one row called "Everything else".`,
    };
  }
  const rows: DashChartRow[] = [];
  for (const [i, item] of raw.rows.entries()) {
    const row = item && typeof item === 'object' ? (item as Record<string, unknown>) : {};
    const label = line(row.label);
    if (!label) return { ok: false, error: `Row ${i + 1} has no label.` };
    const name = cut(label, 30);
    if (series) {
      const values = row.values;
      if (!Array.isArray(values) || values.length !== series.length) {
        return {
          ok: false,
          error: `Row ${i + 1} ("${name}") needs values: one number for each of the ${series.length} series, in the order series names them, null where one has none.`,
        };
      }
      const kept: (number | null)[] = [];
      for (const value of values) {
        if (value === null) kept.push(null);
        else if (typeof value === 'number' && Number.isFinite(value)) kept.push(value);
        else return { ok: false, error: `Row ${i + 1} ("${name}") has a value that is not a number or null.` };
      }
      rows.push({ label: cut(label, MAX_CHART_LABEL), value: kept[0] ?? 0, values: kept });
      continue;
    }
    const value = row.value;
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      return { ok: false, error: `Row ${i + 1} ("${name}") needs a number for its value.` };
    }
    if ((kind === 'bar' || kind === 'columns') && value < 0) {
      return { ok: false, error: `Row ${i + 1} ("${name}") is below zero, which a bar cannot draw. Use a table.` };
    }
    rows.push({ label: cut(label, MAX_CHART_LABEL), value });
  }

  if (trend && rows.length < 2) {
    return { ok: false, error: 'A line needs two or more points, oldest first. A single number is a figure.' };
  }
  if (series && rows.every((row) => row.values?.every((value) => value === null))) {
    return { ok: false, error: 'Every value is null, so there is nothing to draw.' };
  }

  if (kind === 'figure' && rows.length !== 1) {
    return { ok: false, error: 'A figure is one row: the number the question asked for. Put the usual amount in reference.' };
  }
  if (kind === 'columns' && rows.length < 2) {
    return { ok: false, error: 'Columns need two or more periods, oldest first. A single number is a figure.' };
  }

  let reference: DashChartReference | null = null;
  if (raw.reference !== undefined && raw.reference !== null) {
    if (kind !== 'columns' && kind !== 'figure') {
      return { ok: false, error: 'Only columns or a figure take a reference.' };
    }
    const ref = typeof raw.reference === 'object' ? (raw.reference as Record<string, unknown>) : {};
    const refLabel = line(ref.label);
    if (!refLabel) return { ok: false, error: 'The reference needs a label that says what it is, such as "Jun to Aug average".' };
    if (typeof ref.value !== 'number' || !Number.isFinite(ref.value) || ref.value < 0) {
      return { ok: false, error: 'The reference needs a value of zero or more.' };
    }
    reference = { label: cut(refLabel, MAX_CHART_LABEL), value: ref.value };
  }

  const code = line(raw.currency).toUpperCase();
  if (code && !/^[A-Z]{3}$/.test(code)) {
    return { ok: false, error: 'currency must be a three-letter code such as "USD", as the lookup gave it.' };
  }
  const unit = code ? null : cut(line(raw.unit), MAX_CHART_UNIT) || null;

  // A table's headings. With several series the series name the value
  // columns, so only the first heading, the labels', is kept from columns.
  let columns: [string, string] | null = null;
  if (kind === 'table' && Array.isArray(raw.columns)) {
    const [first, second] = raw.columns.map((c) => cut(line(c), MAX_CHART_HEADING));
    if (series && first) columns = [first, ''];
    else if (!series && raw.columns.length === 2 && first && second) columns = [first, second];
  }

  return { ok: true, chart: { kind: chartKind, title, rows, currency: code || null, unit, columns, reference, series } };
}

/** A line or an area: the kinds that draw series over time. */
export function isTrend(kind: ChartKind): kind is (typeof TREND_KINDS)[number] {
  return (TREND_KINDS as readonly string[]).includes(kind);
}

/**
 * The series as the model named them: a list of { name, unit }, or of bare
 * names. Null when none were given; a sentence for the model when they
 * cannot be drawn.
 */
function parseSeries(input: unknown): DashChartSeries[] | null | string {
  if (input === undefined || input === null) return null;
  if (!Array.isArray(input) || input.length === 0) return 'series must be a list naming each line or column.';
  if (input.length > MAX_CHART_SERIES) {
    return `That is ${input.length} series; the most is ${MAX_CHART_SERIES}. Draw the ${MAX_CHART_SERIES} the question is about.`;
  }
  const series: DashChartSeries[] = [];
  for (const [i, item] of input.entries()) {
    const entry: Record<string, unknown> =
      typeof item === 'string' ? { name: item } : item && typeof item === 'object' ? (item as Record<string, unknown>) : {};
    const name = cut(line(entry.name), MAX_CHART_HEADING);
    if (!name) return `Series ${i + 1} has no name.`;
    if (series.some((s) => s.name === name)) return `Two series are both called "${name}"; give each its own name.`;
    series.push({ name, unit: cut(line(entry.unit), MAX_CHART_UNIT) || null });
  }
  return series;
}

/** The series a chart draws: its own, or the one its rows make, named by its unit or its title. */
export function chartSeries(chart: DashChart): DashChartSeries[] {
  if (chart.series && chart.series.length > 0) return chart.series;
  const unit = chart.unit ? chart.unit.charAt(0).toUpperCase() + chart.unit.slice(1) : null;
  return [{ name: unit ?? chart.title, unit: null }];
}

/** A row's value in one series, by its place in chartSeries; null where it has none. */
export function rowValue(chart: DashChart, row: DashChartRow, index: number): number | null {
  if (chart.series && chart.series.length > 0) return row.values?.[index] ?? null;
  return index === 0 ? row.value : null;
}

/** One series' value as the reply prints it: in the series' own unit when it has one, a dash when it has none. */
export function seriesValue(chart: DashChart, series: DashChartSeries | undefined, value: number | null): string {
  if (value === null) return '–';
  if (series?.unit) {
    const number = formatNumber(value, { maximumFractionDigits: 2 });
    return series.unit === '%' ? `${number}%` : `${number} ${series.unit}`;
  }
  return chartValue(chart, value);
}

/** A number short enough for an axis: 18.2k, 1.4m, 0.85, as the Learn charts write them. */
export function axisNumber(value: number): string {
  const size = Math.abs(value);
  if (size >= 1e9) return `${Number((value / 1e9).toPrecision(3))}bn`;
  if (size >= 1e6) return `${Number((value / 1e6).toPrecision(3))}m`;
  if (size >= 1e4) return `${Number((value / 1e3).toPrecision(3))}k`;
  if (size >= 100) return String(Math.round(value)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return String(Number(value.toPrecision(3)));
}

/**
 * Round steps for an axis from min to max: three to six ticks at 1, 2, 2.5
 * or 5 times a power of ten, starting at or below min and ending at or above
 * max, so a scale reads 0%, 0.5%, 1% rather than 0.65%, 1.3%.
 */
export function niceTicks(min: number, max: number): number[] {
  if (!Number.isFinite(min) || !Number.isFinite(max)) return [0, 1];
  if (min === max) {
    const pad = Math.abs(min) || 1;
    return niceTicks(min - pad / 2, max + pad / 2);
  }
  const rough = (max - min) / 4;
  const power = 10 ** Math.floor(Math.log10(rough));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * power).find((s) => s >= rough) ?? 10 * power;
  const first = Math.floor(min / step) * step;
  const ticks: number[] = [];
  for (let at = first; at < max + step * 0.999; at += step) ticks.push(Number(at.toPrecision(12)));
  return ticks;
}

/** How a table is sorted: column -1 is the labels, 0 and on the series; null is the order it was sent in. */
export type ChartSort = { column: number; direction: 'asc' | 'desc' } | null;

/**
 * A table's rows in the order a pressed heading asks for. Labels sort A to Z
 * with numbers in number order; a row with no value in the column goes last
 * whichever way it sorts; ties keep the order the chart was sent in.
 */
export function sortRows(chart: DashChart, sort: ChartSort): DashChartRow[] {
  if (!sort) return chart.rows;
  const sign = sort.direction === 'asc' ? 1 : -1;
  return chart.rows
    .map((row, at) => ({ row, at }))
    .sort((a, b) => {
      if (sort.column < 0) return sign * a.row.label.localeCompare(b.row.label, 'en', { numeric: true }) || a.at - b.at;
      const x = rowValue(chart, a.row, sort.column);
      const y = rowValue(chart, b.row, sort.column);
      if (x === null || y === null) return x === y ? a.at - b.at : x === null ? 1 : -1;
      return sign * (x - y) || a.at - b.at;
    })
    .map(({ row }) => row);
}

/**
 * Where a press on a heading takes the sort: figures largest first and
 * labels A to Z, then the other way, then back to the order it was sent in.
 */
export function nextSort(current: ChartSort, column: number): ChartSort {
  const first = column < 0 ? 'asc' : 'desc';
  if (!current || current.column !== column) return { column, direction: first };
  if (current.direction === first) return { column, direction: first === 'asc' ? 'desc' : 'asc' };
  return null;
}

/**
 * The charts a finished answer drew, in the order made, read from the turn's
 * kept tool calls. A call that failed, or a kept chart that no longer parses,
 * draws nothing.
 */
export function turnCharts(calls: readonly TalkToolCall[] | undefined): DashChart[] {
  const charts: DashChart[] = [];
  for (const call of calls ?? []) {
    if (call.name !== CHART_TOOL || !call.result || typeof call.result !== 'object') continue;
    const result = call.result as { ok?: unknown; chart?: unknown };
    if (result.ok !== true) continue;
    const parsed = parseChart(result.chart);
    if (parsed.ok) charts.push(parsed.chart);
  }
  return charts;
}

/** One value as the reply prints it: money in its currency, anything else as a plain number. */
export function chartValue(chart: Pick<DashChart, 'currency' | 'rows'>, value: number): string {
  if (chart.currency) {
    // Cents on every row or on none, so the column lines up.
    const showCents = chart.rows.some((row) => !Number.isInteger(row.value));
    try {
      return formatMoney(Math.round(value * 100), chart.currency, { showCents });
    } catch {
      // A code Intl does not know: the number and the code, as the lookup said it.
      return `${formatNumber(value)} ${chart.currency}`;
    }
  }
  return formatNumber(value, { maximumFractionDigits: 1 });
}

/**
 * How far a figure sits from its reference, as a whole percentage: 38 for
 * 38% more, -12 for 12% less. Null with no reference, or a reference of zero,
 * which no change can be a share of.
 */
export function chartChange(chart: Pick<DashChart, 'rows' | 'reference'>): number | null {
  const base = chart.reference?.value;
  const value = chart.rows[0]?.value;
  if (base === undefined || value === undefined || base === 0) return null;
  return Math.round(((value - base) / base) * 100);
}

/** A table's headings: the labels' and then one per series. */
export function tableHeadings(chart: DashChart): string[] {
  if (chart.series && chart.series.length > 0) return [chart.columns?.[0] ?? '', ...chart.series.map((s) => s.name)];
  return chartColumns(chart);
}

/** A one-series table's two headings: its own, or the label and what the values are. */
export function chartColumns(chart: DashChart): [string, string] {
  if (chart.columns) return chart.columns;
  const unit = chart.unit ? chart.unit.charAt(0).toUpperCase() + chart.unit.slice(1) : null;
  return ['', chart.currency ? `Amount (${chart.currency})` : (unit ?? 'Value')];
}

/** What the model is told once the chart is drawn. */
export const CHART_DRAWN =
  'The chart is drawn under your answer. Say in a sentence or two what it shows, such as the largest row or the change, rather than listing every figure again.';

/** The tool's definition, sent to the model with the lookups (lib/ask/tools.ts). */
export const CHART_TOOL_DEFINITION = {
  name: CHART_TOOL,
  description: `Draw a chart under your answer. Fill it with the figures a lookup or a web search returned, exactly as it gave them, never estimated. Six kinds:
- figure: the one number a question asks for ("what did I spend in September", "how many applications this month"), set large, with reference set to the usual amount (the average of the periods before, which you work out from the same lookup) or to a target the person wrote down, so the change shows beside it. One row.
- columns: one amount over time, oldest first, the period asked about last: spending by month, applications by week. Two to ${MAX_CHART_ROWS} periods. reference draws a line across them: the target, or the usual amount.
- bar: amounts that are parts of one question, largest first: spending by shop, applications by status. Keep the largest and add the rest together as "Everything else".
- table: figures a length would mislead about, or values below zero, such as days in each stage beside a count. With series, a row carries several values, one column each, such as each index's close and its change over the week; the person can sort by any column.
- line: up to ${MAX_CHART_SERIES} series over the same labels, oldest first, such as the S&P 500, Nasdaq and Dow each day last week: name them in series and give each row values, one per series, null where one has none. Two to ${MAX_CHART_POINTS} points. When the series differ greatly in size, as three indices do, give each as its change since the first point in % (series unit "%"), so they share one scale.
- area: a line with the ground under it filled, for one amount over time, or a few that are parts of one total.
Money goes in whole units with its currency (12.5 for 12.50); give one chart per currency. Draw at most two charts for an answer: a figure and the columns or bar behind it is the usual pair.`,
  input_schema: {
    type: 'object' as const,
    properties: {
      kind: { type: 'string', enum: [...CHART_KINDS], description: 'figure, columns, bar, table, line or area.' },
      title: { type: 'string', description: 'What the chart shows, with its period: "Spending by shop, 2026".' },
      rows: {
        type: 'array',
        minItems: 1,
        maxItems: MAX_CHART_POINTS,
        description: `At most ${MAX_CHART_ROWS} for a figure, columns, bar or table; ${MAX_CHART_POINTS} for a line or an area.`,
        items: {
          type: 'object',
          properties: {
            label: { type: 'string', description: 'The shop, month, day, stage or status, as the lookup named it.' },
            value: { type: 'number', description: 'The figure for that label, for a chart with one series.' },
            values: {
              type: 'array',
              items: { type: ['number', 'null'] },
              description: 'With series: one figure per series, in their order, null where one has none.',
            },
          },
          required: ['label'],
          additionalProperties: false,
        },
      },
      series: {
        type: 'array',
        minItems: 1,
        maxItems: MAX_CHART_SERIES,
        description: 'For a line, an area or a table with several values a row: what each value is, such as the index.',
        items: {
          type: 'object',
          properties: {
            name: { type: 'string', description: 'The series as the person knows it: "S&P 500", "Week change".' },
            unit: { type: 'string', description: 'Its own unit when it is not the chart\'s, such as "%".' },
          },
          required: ['name'],
          additionalProperties: false,
        },
      },
      currency: { type: 'string', description: 'Three-letter code when the values are money, such as "USD".' },
      unit: { type: 'string', description: 'What the values count when they are not money: "applications", "days".' },
      columns: {
        type: 'array',
        minItems: 2,
        maxItems: 2,
        items: { type: 'string' },
        description: 'For a table, its two column headings, such as ["Stage", "Median days"]. With series, give only the labels\' heading; the series name the rest.',
      },
      reference: {
        type: 'object',
        description: 'For a figure or columns: what to measure against, the usual amount or a target.',
        properties: {
          label: { type: 'string', description: 'What it is, with its period: "Jun to Aug average", "Monthly target".' },
          value: { type: 'number', description: 'Its amount, in the same units as the rows.' },
        },
        required: ['label', 'value'],
        additionalProperties: false,
      },
    },
    required: ['kind', 'title', 'rows'],
    additionalProperties: false,
  },
};
