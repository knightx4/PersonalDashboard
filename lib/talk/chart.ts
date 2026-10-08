import { formatMoney } from '@/lib/money';
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
 * Only two kinds. A bar compares amounts that are parts of one question
 * (spend by shop); a table lists figures a length would mislead about, such
 * as days in each stage beside a count. More kinds can follow when a
 * question needs one.
 *
 * Nothing here reads a database or the network, so the thread imports it.
 */

export const CHART_TOOL = 'show_chart';
export const CHART_KINDS = ['bar', 'table'] as const;
export type ChartKind = (typeof CHART_KINDS)[number];

/** The most rows a chart draws: a phone shows twelve bars without scrolling past the answer. */
export const MAX_CHART_ROWS = 12;
export const MAX_CHART_TITLE = 100;
/** Longer labels are cut at a word; a shop or stage name is rarely half this. */
export const MAX_CHART_LABEL = 60;
export const MAX_CHART_HEADING = 30;
export const MAX_CHART_UNIT = 20;

export type DashChartRow = { label: string; value: number };

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
  if (kind !== 'bar' && kind !== 'table') return { ok: false, error: 'kind must be "bar" or "table".' };

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
    if (kind === 'bar' && value < 0) {
      return { ok: false, error: `Row ${i + 1} ("${cut(label, 30)}") is below zero, which a bar cannot draw. Use a table.` };
    }
    rows.push({ label: cut(label, MAX_CHART_LABEL), value });
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

  return { ok: true, chart: { kind, title, rows, currency: code || null, unit, columns } };
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
      return `${value.toLocaleString('en-US')} ${chart.currency}`;
    }
  }
  return value.toLocaleString('en-US', { maximumFractionDigits: 1 });
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
  description: `Draw a bar chart or a small table under your answer, for a question about how something splits or changes: spending by shop, category or month; applications by status, by week or by rejection stage; days spent in each stage. Fill it with the figures a lookup returned, exactly as it gave them, never estimated. A bar compares amounts that answer one question; a table suits figures a bar would mislead about, or values below zero. At most ${MAX_CHART_ROWS} rows, largest first unless the rows are in time order: keep the largest and add the rest together as "Everything else". Money goes in whole units with its currency (12.5 for 12.50); give one chart per currency. Call it at most once or twice for an answer, and only when there are three or more figures to compare; a single figure belongs in the answer's words.`,
  input_schema: {
    type: 'object' as const,
    properties: {
      kind: { type: 'string', enum: [...CHART_KINDS], description: 'bar or table.' },
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
    },
    required: ['kind', 'title', 'rows'],
    additionalProperties: false,
  },
};
