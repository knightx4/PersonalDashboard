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
 * Four kinds. A bar compares amounts that are parts of one question
 * (spend by shop); a table lists figures a length would mislead about, such
 * as days in each stage beside a count; columns show one amount over time,
 * oldest first, the last column the period asked about; a figure is the one
 * number a question asked for, set large. Columns and a figure can carry a
 * reference: the usual amount (an average of the months before) or a target
 * the person set, drawn as a line across the columns or as the change beside
 * the figure.
 *
 * Nothing here reads a database or the network, so the thread imports it.
 */

export const CHART_TOOL = 'show_chart';
export const CHART_KINDS = ['bar', 'table', 'columns', 'figure'] as const;
export type ChartKind = (typeof CHART_KINDS)[number];

/** The most rows a chart draws: a phone shows twelve bars without scrolling past the answer. */
export const MAX_CHART_ROWS = 12;
export const MAX_CHART_TITLE = 100;
/** Longer labels are cut at a word; a shop or stage name is rarely half this. */
export const MAX_CHART_LABEL = 60;
export const MAX_CHART_HEADING = 30;
export const MAX_CHART_UNIT = 20;

export type DashChartRow = { label: string; value: number };

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
    return { ok: false, error: 'kind must be "bar", "table", "columns" or "figure".' };
  }
  const chartKind = kind as ChartKind;

  const title = line(raw.title);
  if (!title) return { ok: false, error: 'Give the chart a title that says what it shows.' };
  if (title.length > MAX_CHART_TITLE) {
    return { ok: false, error: `The title is ${title.length} characters; the most is ${MAX_CHART_TITLE}.` };
  }

  if (!Array.isArray(raw.rows) || raw.rows.length === 0) {
    return { ok: false, error: 'A chart needs at least one row.' };
  }
  if (raw.rows.length > MAX_CHART_ROWS) {
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
    const value = row.value;
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      return { ok: false, error: `Row ${i + 1} ("${cut(label, 30)}") needs a number for its value.` };
    }
    if ((kind === 'bar' || kind === 'columns') && value < 0) {
      return { ok: false, error: `Row ${i + 1} ("${cut(label, 30)}") is below zero, which a bar cannot draw. Use a table.` };
    }
    rows.push({ label: cut(label, MAX_CHART_LABEL), value });
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

  let columns: [string, string] | null = null;
  if (kind === 'table' && Array.isArray(raw.columns) && raw.columns.length === 2) {
    const [first, second] = raw.columns.map((c) => cut(line(c), MAX_CHART_HEADING));
    if (first && second) columns = [first, second];
  }

  return { ok: true, chart: { kind: chartKind, title, rows, currency: code || null, unit, columns, reference } };
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

/** A table's headings: its own, or the label and what the values are. */
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
  description: `Draw a chart under your answer. Fill it with the figures a lookup returned, exactly as it gave them, never estimated. Four kinds:
- figure: the one number a question asks for ("what did I spend in September", "how many applications this month"), set large, with reference set to the usual amount (the average of the periods before, which you work out from the same lookup) or to a target the person wrote down, so the change shows beside it. One row.
- columns: one amount over time, oldest first, the period asked about last: spending by month, applications by week. Two to ${MAX_CHART_ROWS} periods. reference draws a line across them: the target, or the usual amount.
- bar: amounts that are parts of one question, largest first: spending by shop, applications by status. Keep the largest and add the rest together as "Everything else".
- table: figures a length would mislead about, or values below zero, such as days in each stage beside a count.
Money goes in whole units with its currency (12.5 for 12.50); give one chart per currency. Draw at most two charts for an answer: a figure and the columns or bar behind it is the usual pair.`,
  input_schema: {
    type: 'object' as const,
    properties: {
      kind: { type: 'string', enum: [...CHART_KINDS], description: 'figure, columns, bar or table.' },
      title: { type: 'string', description: 'What the chart shows, with its period: "Spending by shop, 2026".' },
      rows: {
        type: 'array',
        minItems: 1,
        maxItems: MAX_CHART_ROWS,
        items: {
          type: 'object',
          properties: {
            label: { type: 'string', description: 'The shop, month, stage or status, as the lookup named it.' },
            value: { type: 'number', description: 'The figure for that label.' },
          },
          required: ['label', 'value'],
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
        description: 'For a table, its two column headings, such as ["Stage", "Median days"].',
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
