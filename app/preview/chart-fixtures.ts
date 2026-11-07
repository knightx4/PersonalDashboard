import type { DashChart } from '@/lib/talk/chart';

/**
 * The charts a bot draws when asked for last week's markets (plan #3050.2),
 * shared by the Ask Dash and People gallery surfaces. A plain module, so a
 * server surface file can import them as values.
 */

/** Last week's markets, as each index's change since Monday's close, the way a web search gives them. */
export const MARKETS_LINE: DashChart = {
  kind: 'line',
  title: 'US markets last week, change since Monday',
  rows: [
    { label: 'Mon 2', value: 0, values: [0, 0, 0] },
    { label: 'Tue 3', value: 0.42, values: [0.42, 0.75, 0.18] },
    { label: 'Wed 4', value: -0.31, values: [-0.31, -0.62, -0.12] },
    { label: 'Thu 5', value: 0.88, values: [0.88, 1.34, 0.41] },
    { label: 'Fri 6', value: 1.12, values: [1.12, 1.71, 0.55] },
  ],
  currency: null,
  unit: null,
  columns: null,
  reference: null,
  series: [
    { name: 'S&P 500', unit: '%' },
    { name: 'Nasdaq', unit: '%' },
    { name: 'Dow Jones', unit: '%' },
  ],
};

/** The same week as a table: each index's close and its change, with the longest index name there is. */
export const MARKETS_TABLE: DashChart = {
  kind: 'table',
  title: 'Closes on Friday 6 November',
  rows: [
    { label: 'S&P 500', value: 6812.4, values: [6812.4, 1.12, 0.42] },
    { label: 'Nasdaq Composite', value: 23104.88, values: [23104.88, 1.71, 0.75] },
    { label: 'Dow Jones Industrial Average', value: 47560.12, values: [47560.12, 0.55, 0.18] },
    { label: 'Russell 2000', value: 2451.3, values: [2451.3, -0.84, -1.2] },
  ],
  currency: null,
  unit: null,
  columns: ['Index', ''],
  reference: null,
  series: [
    { name: 'Close', unit: null },
    { name: 'Week change', unit: '%' },
    { name: 'Best day', unit: '%' },
  ],
};
