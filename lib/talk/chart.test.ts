import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';
import { executeAskTool } from '@/lib/ask/tools';
import type { AskContext } from '@/lib/ask/db';
import { ReplyCharts } from '@/components/talk/reply-chart';
import { turnLookups } from './lookups';
import { toTalkTurn } from './talk';
import { CHART_TOOL, MAX_CHART_LABEL, MAX_CHART_ROWS, chartColumns, chartValue, parseChart, turnCharts } from './chart';

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
      },
    });
  });

  it(`takes ${MAX_CHART_ROWS} rows and refuses one more, saying how to fold the rest`, () => {
    expect(parseChart({ kind: 'bar', title: 'T', rows: rows(MAX_CHART_ROWS) }).ok).toBe(true);
    expect(expectError({ kind: 'bar', title: 'T', rows: rows(MAX_CHART_ROWS + 1) })).toMatch(/Everything else/);
  });

  it('refuses a chart with no rows, no title or an unknown kind', () => {
    expect(expectError({ kind: 'bar', title: 'T', rows: [] })).toMatch(/at least one row/);
    expect(expectError({ kind: 'bar', title: '  ', rows: rows(2) })).toMatch(/title/);
    expect(expectError({ kind: 'pie', title: 'T', rows: rows(2) })).toMatch(/bar.*table/);
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
