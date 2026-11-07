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
  MAX_CHART_LABEL,
  MAX_CHART_ROWS,
  chartChange,
  chartColumns,
  chartValue,
  parseChart,
  sortedRows,
  tableHeadings,
  turnCharts,
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
});

describe('line and area charts with several series (plan #3050.2.1)', () => {
  const MARKETS = {
    kind: 'line',
    title: 'The markets, 2 to 6 November',
    unit: '%',
    series: ['S&P 500', 'Nasdaq', 'Dow'],
    rows: [
      { label: 'Mon', values: [0, 0, 0] },
      { label: 'Tue', values: [0.6, 0.9, 0.3] },
      { label: 'Wed', values: [-0.4, -0.8, 0.1] },
      { label: 'Thu', values: [0.9, 1.4, 0.5] },
      { label: 'Fri', values: [1.3, 1.9, 0.8] },
    ],
  };

  it('takes a line with a value per series on each row', () => {
    const parsed = parseChart(MARKETS);
    expect(parsed.ok && parsed.chart.series).toEqual(['S&P 500', 'Nasdaq', 'Dow']);
    expect(parsed.ok && parsed.chart.rows[2]).toEqual({ label: 'Wed', value: -0.4, values: [-0.4, -0.8, 0.1] });
  });

  it('names the one series of a line sent with plain values', () => {
    const parsed = parseChart({
      kind: 'area',
      title: 'Balance',
      currency: 'USD',
      rows: [
        { label: '1 Nov', value: 10 },
        { label: '2 Nov', value: 12 },
      ],
    });
    expect(parsed.ok && parsed.chart.series).toEqual(['USD']);
    expect(parsed.ok && parsed.chart.rows[1].values).toEqual([12]);
  });

  it('refuses a row whose values do not match the series, too many series, or series on a bar', () => {
    const short = { ...MARKETS, rows: [{ label: 'Mon', values: [0, 0] }, ...MARKETS.rows.slice(1)] };
    expect(expectError(short)).toMatch(/3 numbers, one for each of S&P 500, Nasdaq, Dow/);
    expect(expectError({ ...MARKETS, series: ['A', 'B', 'C', 'D', 'E'] })).toMatch(/the most is 4/);
    expect(expectError({ kind: 'bar', title: 'T', rows: rows(2), series: ['A'] })).toMatch(/Only a line, an area or a table/);
    expect(expectError({ ...MARKETS, rows: MARKETS.rows.slice(0, 1) })).toMatch(/two or more points/);
  });

  it('takes a month of days on a line, and no more', () => {
    const days = (n: number) => Array.from({ length: n }, (_, i) => ({ label: `${i + 1} Oct`, value: i }));
    expect(parseChart({ kind: 'line', title: 'T', rows: days(31) }).ok).toBe(true);
    expect(expectError({ kind: 'line', title: 'T', rows: days(32) })).toMatch(/the most is 31/);
  });

  it('draws the key, the open-full-screen button and the figures a screen reader hears', () => {
    const parsed = parseChart(MARKETS);
    if (!parsed.ok) throw new Error(parsed.error);
    const html = renderToStaticMarkup(createElement(ReplyChart, { chart: parsed.chart }));
    for (const name of ['S&amp;P 500', 'Nasdaq', 'Dow']) expect(html).toContain(name);
    expect(html).toContain('aria-label="Open full screen"');
    expect(html).toContain('+1.9%');
    expect(html).toContain('-0.8%');
  });

  it('draws a kept line again from the turn', () => {
    const parsed = parseChart(MARKETS);
    if (!parsed.ok) throw new Error(parsed.error);
    const calls = [{ name: CHART_TOOL, input: MARKETS, result: { ok: true, chart: parsed.chart } }];
    expect(turnCharts(calls)).toEqual([parsed.chart]);
  });
});

describe('a table with series sorts by column (plan #3050.2.1)', () => {
  const parsed = parseChart({
    kind: 'table',
    title: 'Roles by stage',
    columns: ['Stage'],
    series: ['Roles', 'Median days'],
    rows: [
      { label: 'Applied', values: [14, 9] },
      { label: 'First interview', values: [3, 23] },
      { label: 'Recruiter screen', values: [5, 14] },
    ],
  });
  if (!parsed.ok) throw new Error(parsed.error);
  const chart = parsed.chart;

  it('heads the label column and one column per series', () => {
    expect(tableHeadings(chart)).toEqual(['Stage', 'Roles', 'Median days']);
  });

  it('sorts by any column either way, and keeps the sent order with no sort', () => {
    const labels = (sort: Parameters<typeof sortedRows>[1]) => sortedRows(chart, sort).map((row) => row.label);
    expect(labels(null)).toEqual(['Applied', 'First interview', 'Recruiter screen']);
    expect(labels({ column: 2, descending: true })).toEqual(['First interview', 'Recruiter screen', 'Applied']);
    expect(labels({ column: 1, descending: false })).toEqual(['First interview', 'Recruiter screen', 'Applied']);
    expect(labels({ column: 0, descending: true })).toEqual(['Recruiter screen', 'First interview', 'Applied']);
  });

  it('draws a sort button in every heading, and scrolls sideways', () => {
    const html = renderToStaticMarkup(createElement(ReplyChart, { chart }));
    expect(html.match(/aria-sort="none"/g)).toHaveLength(3);
    expect(html).toContain('overflow-x-auto');
    expect(html).toContain('Median days');
  });

  it('keeps an older two-column table as it was, sortable too', () => {
    const old = parseChart({ kind: 'table', title: 'T', rows: rows(2), columns: ['Stage', 'Median days'] });
    if (!old.ok) throw new Error(old.error);
    expect(tableHeadings(old.chart)).toEqual(['Stage', 'Median days']);
    const html = renderToStaticMarkup(createElement(ReplyChart, { chart: old.chart }));
    expect(html).not.toContain('overflow-x-auto');
    expect(html).not.toContain('Open full screen');
  });
});
