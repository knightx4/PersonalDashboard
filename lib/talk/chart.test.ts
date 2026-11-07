import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';
import { executeAskTool } from '@/lib/ask/tools';
import type { AskContext } from '@/lib/ask/db';
import { ReplyChart, ReplyCharts } from '@/components/talk/reply-chart';
import { turnLookups } from './lookups';
import { toTalkTurn } from './talk';
import {
  CHART_TOOL,
  CHART_TOOL_DEFINITION,
  MAX_CHART_LABEL,
  MAX_CHART_POINTS,
  MAX_CHART_ROWS,
  chartChange,
  chartColumns,
  chartValue,
  nextSort,
  parseChart,
  seriesValue,
  sortRows,
  tableHeadings,
  turnCharts,
  type DashChart,
} from './chart';

const rows = (n: number) => Array.from({ length: n }, (_, i) => ({ label: `Shop ${i + 1}`, value: (n - i) * 10 }));

function expectError(input: unknown): string {
  const parsed = parseChart(input);
  if (parsed.ok) throw new Error('expected the chart to be refused');
  return parsed.error;
}

describe('parseChart', () => {
  it('takes a bar of spending with its currency', () => {
    const parsed = parseChart({ kind: 'bar', title: ' Spending by shop, 2026 ', rows: rows(3), currency: 'usd' });
    expect(parsed).toEqual({
      ok: true,
      chart: {
        kind: 'bar',
        title: 'Spending by shop, 2026',
        rows: rows(3),
        currency: 'USD',
        unit: null,
        columns: null,
        reference: null,
        series: null,
      },
    });
  });

  it('takes a figure of one row with the usual amount as its reference', () => {
    const parsed = parseChart({
      kind: 'figure',
      title: 'Food delivery, September',
      rows: [{ label: 'September, 19 orders', value: 412.8 }],
      currency: 'USD',
      reference: { label: 'Jun to Aug average', value: 299 },
    });
    expect(parsed.ok && parsed.chart.reference).toEqual({ label: 'Jun to Aug average', value: 299 });
    expect(parsed.ok && chartChange(parsed.chart)).toBe(38);
    expect(expectError({ kind: 'figure', title: 'T', rows: rows(2) })).toMatch(/one row/);
  });

  it('takes columns in time order and refuses one column or a column below zero', () => {
    const months = [
      { label: 'Jul', value: 276 },
      { label: 'Aug', value: 316 },
      { label: 'Sep', value: 412.8 },
    ];
    const parsed = parseChart({ kind: 'columns', title: 'T', rows: months, reference: { label: 'Target', value: 300 } });
    expect(parsed.ok && parsed.chart.rows.map((row) => row.label)).toEqual(['Jul', 'Aug', 'Sep']);
    expect(expectError({ kind: 'columns', title: 'T', rows: [{ label: 'Sep', value: 1 }] })).toMatch(/figure/);
    expect(expectError({ kind: 'columns', title: 'T', rows: [{ label: 'Jul', value: 1 }, { label: 'Aug', value: -1 }] })).toMatch(
      /below zero/,
    );
  });

  it('refuses a reference on a bar or a table, or one without a label or a value', () => {
    expect(expectError({ kind: 'bar', title: 'T', rows: rows(3), reference: { label: 'Avg', value: 1 } })).toMatch(
      /Only columns or a figure/,
    );
    expect(expectError({ kind: 'figure', title: 'T', rows: rows(1), reference: { value: 1 } })).toMatch(/label/);
    expect(expectError({ kind: 'figure', title: 'T', rows: rows(1), reference: { label: 'Avg', value: -1 } })).toMatch(
      /zero or more/,
    );
  });

  it('gives no change against a reference of zero, and none without one', () => {
    const chart = { rows: [{ label: 'A', value: 10 }] };
    expect(chartChange({ ...chart, reference: { label: 'Avg', value: 0 } })).toBeNull();
    expect(chartChange({ ...chart, reference: null })).toBeNull();
    expect(chartChange({ rows: [{ label: 'A', value: 90 }], reference: { label: 'Avg', value: 100 } })).toBe(-10);
  });

  it(`takes ${MAX_CHART_ROWS} rows and refuses one more, saying how to fold the rest`, () => {
    expect(parseChart({ kind: 'bar', title: 'T', rows: rows(MAX_CHART_ROWS) }).ok).toBe(true);
    expect(expectError({ kind: 'bar', title: 'T', rows: rows(MAX_CHART_ROWS + 1) })).toMatch(/Everything else/);
  });

  it('refuses a chart with no rows, no title or an unknown kind', () => {
    expect(expectError({ kind: 'bar', title: 'T', rows: [] })).toMatch(/at least one row/);
    expect(expectError({ kind: 'bar', title: '  ', rows: rows(2) })).toMatch(/title/);
    expect(expectError({ kind: 'pie', title: 'T', rows: rows(2) })).toMatch(/bar.*table.*columns.*figure/);
    expect(expectError({ kind: 'bar', title: 'x'.repeat(101), rows: rows(2) })).toMatch(/101 characters/);
  });

  it('refuses a value that is not a number, and a bar below zero', () => {
    expect(expectError({ kind: 'bar', title: 'T', rows: [{ label: 'A', value: '12' }] })).toMatch(/number/);
    expect(expectError({ kind: 'bar', title: 'T', rows: [{ label: 'A', value: Number.NaN }] })).toMatch(/number/);
    expect(expectError({ kind: 'bar', title: 'T', rows: [{ label: 'Refunds', value: -20 }] })).toMatch(/table/);
    expect(parseChart({ kind: 'table', title: 'T', rows: [{ label: 'Refunds', value: -20 }] }).ok).toBe(true);
  });

  it('cuts a long label at a word, and refuses a currency that is not a code', () => {
    const long = 'The Very Long Named Independent Bookshop and Coffee House of Upper Street';
    const parsed = parseChart({ kind: 'bar', title: 'T', rows: [{ label: long, value: 1 }] });
    expect(parsed.ok && parsed.chart.rows[0].label.length).toBeLessThanOrEqual(MAX_CHART_LABEL);
    expect(parsed.ok && parsed.chart.rows[0].label.endsWith('…')).toBe(true);
    expect(expectError({ kind: 'bar', title: 'T', rows: rows(2), currency: 'dollars' })).toMatch(/three-letter/);
  });

  it("keeps a table's headings, and only a table's", () => {
    const table = parseChart({ kind: 'table', title: 'T', rows: rows(2), unit: 'days', columns: ['Stage', 'Median days'] });
    expect(table.ok && table.chart.columns).toEqual(['Stage', 'Median days']);
    const bar = parseChart({ kind: 'bar', title: 'T', rows: rows(2), columns: ['Stage', 'Days'] });
    expect(bar.ok && bar.chart.columns).toBeNull();
  });
});

/** Last week's markets as Newt would draw them: each index's change since Monday, in %. */
const MARKETS = {
  kind: 'line',
  title: 'US markets last week',
  series: [
    { name: 'S&P 500', unit: '%' },
    { name: 'Nasdaq', unit: '%' },
    { name: 'Dow Jones', unit: '%' },
  ],
  rows: [
    { label: 'Mon', values: [0, 0, 0] },
    { label: 'Tue', values: [0.42, 0.75, 0.18] },
    { label: 'Wed', values: [-0.31, -0.62, null] },
    { label: 'Thu', values: [0.88, 1.34, 0.41] },
    { label: 'Fri', values: [1.12, 1.71, 0.55] },
  ],
};

/** Three indices with their close, week change and best day. */
const CLOSES = {
  kind: 'table',
  title: 'Closes on Friday',
  columns: ['Index'],
  series: ['Close', { name: 'Week change', unit: '%' }, { name: 'Best day', unit: '%' }],
  rows: [
    { label: 'S&P 500', values: [6812.4, 1.12, 0.42] },
    { label: 'Nasdaq', values: [23104.88, 1.71, null] },
    { label: 'Dow Jones', values: [47560.12, 0.55, 0.18] },
  ],
};

function chart(input: unknown): DashChart {
  const parsed = parseChart(input);
  if (!parsed.ok) throw new Error(parsed.error);
  return parsed.chart;
}

describe('several series (plan #3050.2.1)', () => {
  it('takes a line of three series over five days, null where one has none', () => {
    const line = chart(MARKETS);
    expect(line.kind).toBe('line');
    expect(line.series?.map((s) => s.name)).toEqual(['S&P 500', 'Nasdaq', 'Dow Jones']);
    expect(line.rows[2]).toEqual({ label: 'Wed', value: -0.31, values: [-0.31, -0.62, null] });
    expect(chart({ ...MARKETS, kind: 'area' }).kind).toBe('area');
  });

  it('takes a line of one series from plain values, below zero too', () => {
    const line = chart({ kind: 'line', title: 'Balance', rows: [{ label: 'Jan', value: -20 }, { label: 'Feb', value: 40 }] });
    expect(line.series).toBeNull();
    expect(expectError({ kind: 'line', title: 'T', rows: [{ label: 'Jan', value: 1 }] })).toMatch(/two or more points/);
  });

  it(`takes ${MAX_CHART_POINTS} points on a line, where a bar stops at ${MAX_CHART_ROWS}`, () => {
    const days = Array.from({ length: MAX_CHART_POINTS }, (_, i) => ({ label: `Day ${i + 1}`, value: i }));
    expect(chart({ kind: 'line', title: 'T', rows: days }).rows).toHaveLength(MAX_CHART_POINTS);
    expect(expectError({ kind: 'line', title: 'T', rows: [...days, { label: 'One more', value: 1 }] })).toMatch(/one a week/);
  });

  it('refuses rows whose values do not match the series, and series on a bar', () => {
    expect(expectError({ ...MARKETS, rows: [{ label: 'Mon', values: [1, 2] }, ...MARKETS.rows] })).toMatch(/each of the 3 series/);
    expect(expectError({ ...MARKETS, rows: [{ label: 'Mon', values: [1, 'x', 3] }, ...MARKETS.rows] })).toMatch(/not a number/);
    expect(expectError({ ...MARKETS, series: ['A', 'B', 'C', 'D', 'E'] })).toMatch(/the most is 4/);
    expect(expectError({ ...MARKETS, series: ['A', 'A', 'B'] })).toMatch(/both called "A"/);
    expect(expectError({ kind: 'bar', title: 'T', series: ['A'], rows: [{ label: 'x', values: [1] }] })).toMatch(/Only a line/);
    expect(expectError({ ...MARKETS, rows: MARKETS.rows.map((row) => ({ ...row, values: [null, null, null] })) })).toMatch(/nothing to draw/);
  });

  it("names a table's columns from its series, after the labels' heading", () => {
    const table = chart(CLOSES);
    expect(tableHeadings(table)).toEqual(['Index', 'Close', 'Week change', 'Best day']);
    expect(seriesValue(table, table.series?.[1], 1.71)).toBe('1.71%');
    expect(seriesValue(table, table.series?.[0], 23104.88)).toBe('23,104.9');
    expect(seriesValue(table, table.series?.[2], null)).toBe('–');
  });

  it('sorts by a column largest first, then smallest, then as sent, with a missing value last', () => {
    const table = chart(CLOSES);
    const labels = (sort: Parameters<typeof sortRows>[1]) => sortRows(table, sort).map((row) => row.label);
    let sort = nextSort(null, 1);
    expect(sort).toEqual({ column: 1, direction: 'desc' });
    expect(labels(sort)).toEqual(['Nasdaq', 'S&P 500', 'Dow Jones']);
    sort = nextSort(sort, 1);
    expect(labels(sort)).toEqual(['Dow Jones', 'S&P 500', 'Nasdaq']);
    expect(nextSort(sort, 1)).toBeNull();
    expect(labels({ column: 2, direction: 'desc' })).toEqual(['S&P 500', 'Dow Jones', 'Nasdaq']);
    expect(labels({ column: 2, direction: 'asc' })).toEqual(['Dow Jones', 'S&P 500', 'Nasdaq']);
    expect(nextSort(null, -1)).toEqual({ column: -1, direction: 'asc' });
    expect(labels({ column: -1, direction: 'asc' })).toEqual(['Dow Jones', 'Nasdaq', 'S&P 500']);
  });

  it('sorts a one-series table kept before series by its value', () => {
    const table = chart({ kind: 'table', title: 'T', rows: [{ label: 'A', value: 2 }, { label: 'B', value: 9 }], columns: ['Stage', 'Days'] });
    expect(sortRows(table, { column: 0, direction: 'desc' }).map((row) => row.label)).toEqual(['B', 'A']);
  });

  it('tells the model about lines, areas and series', () => {
    expect(CHART_TOOL_DEFINITION.description).toMatch(/- line: up to 4 series/);
    expect(CHART_TOOL_DEFINITION.input_schema.properties.series).toBeDefined();
  });
});

describe('chartValue and chartColumns', () => {
  it('prints money in its currency, with cents on every row or none', () => {
    const whole = { currency: 'USD', rows: [{ label: 'A', value: 214 }] };
    expect(chartValue(whole, 214)).toBe('$214');
    const cents = { currency: 'USD', rows: [{ label: 'A', value: 214 }, { label: 'B', value: 12.5 }] };
    expect(chartValue(cents, 214)).toBe('$214.00');
    expect(chartValue({ currency: null, rows: [] }, 1234)).toBe('1,234');
  });

  it("names a table's value column from its unit or currency when it has no headings", () => {
    const parsed = parseChart({ kind: 'table', title: 'T', rows: rows(2), unit: 'applications' });
    expect(parsed.ok && chartColumns(parsed.chart)).toEqual(['', 'Applications']);
  });
});

describe('the show_chart tool', () => {
  const ctx = { enabledModules: [] } as unknown as AskContext;

  it('keeps the chart as its result and tells the model it is drawn', async () => {
    const result = await executeAskTool(CHART_TOOL, { kind: 'bar', title: 'Spend', rows: rows(3), currency: 'GBP' }, ctx);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.rows).toEqual([]);
    expect(result.note).toMatch(/drawn under your answer/);
    expect(result.kept).toMatchObject({ chart: { kind: 'bar', currency: 'GBP' } });
  });

  it('hands the limit back to the model as an error', async () => {
    const result = await executeAskTool(CHART_TOOL, { kind: 'bar', title: 'Spend', rows: rows(13) }, ctx);
    expect(result).toEqual({ ok: false, error: expect.stringMatching(/the most is 12/) });
  });
});

describe('a saved turn', () => {
  // A turn as core.conversation_turns returns it: the chart is the kept
  // result of the show_chart call (keptResult in lib/dash/loop.ts).
  const saved = toTalkTurn({
    id: 't1',
    role: 'assistant',
    body: 'Amazon is most of it.',
    created_at: '2026-10-01T09:00:00Z',
    tool_calls: [
      { name: 'spend_by_merchant', input: { from: '2026-01-01' }, result: { ok: true, rows: [] } },
      {
        name: CHART_TOOL,
        input: {},
        result: {
          ok: true,
          chart: { kind: 'bar', title: 'Spending by shop, 2026', rows: [{ label: 'Amazon', value: 1843.2 }, { label: 'eBay', value: 412.6 }], currency: 'USD', unit: null, columns: null },
        },
      },
      { name: CHART_TOOL, input: {}, result: { ok: false, error: 'kind must be "bar" or "table".' } },
    ],
  });

  it('gives its chart back when the conversation is reopened, and not a failed one', () => {
    const charts = turnCharts(saved.toolCalls);
    expect(charts).toHaveLength(1);
    expect(charts[0].title).toBe('Spending by shop, 2026');
  });

  it('draws the chart again, and leaves it out of the lookup lines', () => {
    const html = renderToStaticMarkup(createElement(ReplyCharts, { calls: saved.toolCalls }));
    expect(html).toContain('Spending by shop, 2026');
    expect(html).toContain('Amazon');
    expect(html).toContain('$1,843.20');
    expect(turnLookups(saved.toolCalls).map((line) => line.label)).toEqual(['Adding up spending']);
  });

  it('draws nothing for a turn with no chart', () => {
    expect(renderToStaticMarkup(createElement(ReplyCharts, { calls: undefined }))).toBe('');
  });
});

describe('ReplyChart', () => {
  const draw = (input: unknown) => {
    const parsed = parseChart(input);
    if (!parsed.ok) throw new Error(parsed.error);
    return renderToStaticMarkup(createElement(ReplyChart, { chart: parsed.chart }));
  };

  it('sets a figure large with its change from the usual amount told in words', () => {
    const html = draw({
      kind: 'figure',
      title: 'Food delivery, September',
      rows: [{ label: 'September, 19 orders', value: 412.8 }],
      currency: 'USD',
      reference: { label: 'Jun to Aug average', value: 299 },
    });
    expect(html).toContain('$412.80');
    expect(html).toContain('38% more than Jun to Aug average');
    expect(html).toContain('$299.00');
  });

  it('draws a column for each period, names the last, and the reference line', () => {
    const html = draw({
      kind: 'columns',
      title: 'Food delivery by month',
      rows: [
        { label: 'Jul', value: 276 },
        { label: 'Aug', value: 316 },
        { label: 'Sep', value: 412 },
      ],
      currency: 'USD',
      reference: { label: 'Target', value: 300 },
    });
    expect(html.match(/<li/g)).toHaveLength(3);
    expect(html).toContain('Jul: $276');
    expect(html).toContain('Target, <span class="tabular">$300');
  });

  it('draws a line with a key naming each series, its figures for a screen reader, and a full-screen button', () => {
    const html = draw(MARKETS);
    for (const name of ['S&amp;P 500', 'Nasdaq', 'Dow Jones']) expect(html).toContain(`</span>${name}</button>`);
    expect(html.match(/aria-pressed=/g)).toHaveLength(3);
    expect(html).toContain('1.71%');
    expect(html).toContain('aria-label="Open full screen"');
  });

  it('draws a table with a sorting button on every heading, sideways scroll when wide, and a dash for a missing value', () => {
    const html = draw(CLOSES);
    expect(html.match(/<th[^>]*scope="col"/g)).toHaveLength(4);
    expect(html.match(/, sort<\/span>/g)).toHaveLength(4);
    expect(html).toContain('overflow-x-auto');
    expect(html).toContain('47,560.1');
    expect(html).toContain('–');
    expect(html).toContain('aria-label="Open full screen"');
  });

  it('draws a two-column table kept before series as it did, with no sideways scroll', () => {
    const html = draw({ kind: 'table', title: 'Days', rows: [{ label: 'Applied', value: 9 }], unit: 'days', columns: ['Stage', 'Median days'] });
    expect(html).toContain('Median days');
    expect(html).not.toContain('overflow-x-auto');
  });

  it('opens no full screen for a bar, columns or a figure', () => {
    expect(draw({ kind: 'bar', title: 'T', rows: rows(2) })).not.toContain('Open full screen');
  });
});
