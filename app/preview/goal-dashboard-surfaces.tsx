import { DashboardTiles } from '@/app/goals/[goalId]/dashboard-tiles';
import type { CollectionField } from '@/lib/goals/collections';
import { tileProblem, type DashboardContext, type Tile } from '@/lib/goals/dashboard';
import { tileView, type DashboardData, type TileList, type TileReading, type TileView } from '@/lib/goals/dashboard-tiles';
import { countByPeriod, type Metric } from '@/lib/goals/metrics';

/**
 * A goal's dashboard tiles drawn from fixtures for the gallery (plan
 * #2778.2): a loans goal with a total, two countdowns, a line of the
 * balances, a bar chart of a metric and the loans as a table. Every view
 * goes through tileProblem and tileView, as the page's do, so what is drawn
 * is what those rows would give on 3 Nov 2026. The lender, the loans and the
 * amounts are made up.
 */

const TODAY = '2026-11-03';
const NOW = new Date('2026-11-03T12:00:00Z');
const GOAL = 'f0000000-0000-4000-8000-000000000001';

const LOANS_ID = 'a0000000-0000-4000-8000-000000000001';
const PAYMENTS_ID = 'a0000000-0000-4000-8000-000000000002';
const METRIC_ID = 'b0000000-0000-4000-8000-000000000001';
const STEP_ID = 'c0000000-0000-4000-8000-000000000001';
const BARE_STEP_ID = 'c0000000-0000-4000-8000-000000000002';

const LOAN_FIELDS: CollectionField[] = [
  { key: 'name', label: 'Loan', type: 'text' },
  { key: 'rate', label: 'Rate', type: 'percent' },
  { key: 'balance', label: 'Balance', type: 'money', tracked: true },
  { key: 'first_bill', label: 'First bill', type: 'date' },
  { key: 'notes', label: 'Notes', type: 'long_text' },
];

const PAYMENT_FIELDS: CollectionField[] = [
  { key: 'name', label: 'Payment', type: 'text' },
  { key: 'paid_on', label: 'Paid on', type: 'date' },
  { key: 'amount', label: 'Amount', type: 'money' },
];

const LOANS: [string, number, number, string][] = [
  ['Grad PLUS 2024–25', 9.08, 52000, '2026-12-18'],
  ['Grad PLUS 2025–26', 8.94, 47500, '2026-12-18'],
  ['Direct Unsubsidized 2024–25', 8.08, 14800, '2026-12-19'],
  ['Direct Unsubsidized 2025–26', 7.94, 12900, '2026-12-19'],
];

const loanId = (i: number) => `d0000000-0000-4000-8000-00000000000${i + 1}`;

const LOAN_LIST: TileList = {
  id: LOANS_ID,
  name: 'Loans',
  fields: LOAN_FIELDS,
  records: LOANS.map(([name, rate, balance, firstBill], i) => ({
    id: loanId(i),
    data: { name, rate, balance, first_bill: firstBill },
    draft: false,
  })),
};

/** A balance logged on the 1st of each month since July, each loan a little lower each time. */
const READINGS: TileReading[] = ['2026-07-01', '2026-08-01', '2026-09-01', '2026-10-01', '2026-11-01'].flatMap(
  (readOn, month) =>
    LOANS.map(([, , balance], i) => ({
      recordId: loanId(i),
      field: 'balance',
      value: Math.round(balance * (1 + (4 - month) * 0.009)),
      readOn,
    })),
);

const PAID = ['2026-07-14', '2026-08-14', '2026-08-28', '2026-09-14', '2026-10-14', '2026-10-30', '2026-11-02'];

const PAYMENT_LIST: TileList = {
  id: PAYMENTS_ID,
  name: 'Payments',
  fields: PAYMENT_FIELDS,
  records: PAID.map((paidOn, i) => ({
    id: `e0000000-0000-4000-8000-00000000000${i}`,
    data: { name: `Extra payment ${i + 1}`, paid_on: paidOn, amount: 500 },
    draft: false,
  })),
};

const METRIC: Metric = {
  id: METRIC_ID,
  goalId: GOAL,
  name: 'Extra payments made',
  source: 'list',
  collectionId: PAYMENTS_ID,
  dateField: 'paid_on',
  period: 'month',
  target: 1,
  position: 0,
};

function counts(list: TileList) {
  return countByPeriod({
    records: list.records,
    dateField: 'paid_on',
    period: 'month',
    goalStartedAt: '2026-06-10T09:00:00Z',
    now: NOW,
    timeZone: 'Europe/London',
  });
}

const DATA: DashboardData = {
  today: TODAY,
  lists: [LOAN_LIST, PAYMENT_LIST],
  metrics: [{ ...METRIC, counts: counts(PAYMENT_LIST) }],
  steps: [
    { id: STEP_ID, title: 'Save the approval letter showing the $0 payment', dueOn: '2026-11-20', status: 'open', closedOn: null },
    { id: BARE_STEP_ID, title: 'Recertify income for the repayment plan', dueOn: null, status: 'open', closedOn: null },
  ],
  readings: READINGS,
};

const contextOf = (data: DashboardData): DashboardContext => ({
  lists: data.lists,
  metrics: data.metrics,
  stepIds: new Set(data.steps.map((s) => s.id)),
});

function views(tiles: Tile[], data: DashboardData): TileView[] {
  const context = contextOf(data);
  return tiles.map((tile, index) => tileView(tile, index, tileProblem(tile, context), data));
}

const TILES: Tile[] = [
  { type: 'number', title: 'Total owed', list: LOANS_ID, field: 'balance' },
  { type: 'countdown', title: 'First bill', list: LOANS_ID, field: 'first_bill' },
  { type: 'countdown', title: 'Approval letter', step: STEP_ID },
  { type: 'chart', style: 'line', title: 'Balance to zero', list: LOANS_ID, field: 'balance' },
  { type: 'chart', style: 'bar', metric: METRIC_ID },
  { type: 'table', list: LOANS_ID, fields: ['name', 'rate', 'balance', 'first_bill'] },
];

/** The same goal before anything is in it: no rows, nothing counted, a step with no date. */
const EMPTY_DATA: DashboardData = {
  ...DATA,
  lists: [
    { ...LOAN_LIST, records: [] },
    { ...PAYMENT_LIST, records: [] },
  ],
  metrics: [{ ...METRIC, counts: counts({ ...PAYMENT_LIST, records: [] }) }],
  readings: [],
};

const EMPTY_TILES: Tile[] = [
  { type: 'number', title: 'Total owed', list: LOANS_ID, field: 'balance' },
  { type: 'countdown', title: 'First bill', list: LOANS_ID, field: 'first_bill' },
  { type: 'countdown', step: BARE_STEP_ID },
  { type: 'chart', style: 'line', title: 'Balance to zero', list: LOANS_ID, field: 'balance' },
  { type: 'chart', style: 'bar', metric: METRIC_ID },
  { type: 'table', list: LOANS_ID, fields: ['name', 'rate', 'balance', 'first_bill'] },
];

const GONE = 'a0000000-0000-4000-8000-0000000000ff';

/** Tiles whose sources have gone or changed since they were laid out. */
const BROKEN_TILES: Tile[] = [
  { type: 'number', title: 'Total saved', list: GONE, field: 'amount' },
  { type: 'countdown', title: 'Next bill', list: LOANS_ID, field: 'rate' },
  { type: 'chart', style: 'line', title: 'Rate over time', list: LOANS_ID, field: 'rate' },
  { type: 'table', title: 'Loans', list: LOANS_ID, fields: ['name', 'servicer'] },
];

export function GoalDashboardTilesSurface() {
  return <DashboardTiles goalId={GOAL} views={views(TILES, DATA)} />;
}

/** The quick add open: a new balance on the total, and a new row on the table. */
export function GoalDashboardTilesAddSurface() {
  return <DashboardTiles goalId={GOAL} views={views(TILES, DATA)} seams={{ addOpen: [0, 5] }} />;
}

/** The menu on the line chart open: Move earlier, Move later, Remove. */
export function GoalDashboardTilesMenuSurface() {
  return <DashboardTiles goalId={GOAL} views={views(TILES, DATA)} seams={{ menuOpen: 3 }} />;
}

/** Every type with its source empty, each saying what it will show. */
export function GoalDashboardTilesEmptySurface() {
  return <DashboardTiles goalId={GOAL} views={views(EMPTY_TILES, EMPTY_DATA)} />;
}

/** Every type broken, each naming the list or field that is missing. */
export function GoalDashboardTilesBrokenSurface() {
  return <DashboardTiles goalId={GOAL} views={views(BROKEN_TILES, DATA)} />;
}
