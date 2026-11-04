import { describe, expect, it } from 'vitest';
import type { CollectionField } from '@/lib/goals/collections';
import { tileProblem, type DashboardContext, type Tile } from '@/lib/goals/dashboard';
import {
  TABLE_ROWS_MAX,
  combinedSeries,
  countdownWords,
  daysBetween,
  tileView,
  type DashboardData,
  type TileList,
} from '@/lib/goals/dashboard-tiles';
import type { Metric } from '@/lib/goals/metrics';

const LIST = '11111111-1111-4111-8111-111111111111';
const METRIC = '22222222-2222-4222-8222-222222222222';
const STEP = '33333333-3333-4333-8333-333333333333';

const FIELDS: CollectionField[] = [
  { key: 'name', label: 'Loan', type: 'text' },
  { key: 'balance', label: 'Balance', type: 'money', tracked: true },
  { key: 'rate', label: 'Rate', type: 'percent' },
  { key: 'due', label: 'Due', type: 'date' },
];

const list = (records: TileList['records']): TileList => ({ id: LIST, name: 'Loans', fields: FIELDS, records });
const row = (id: string, data: TileList['records'][number]['data'], draft = false) => ({ id, data, draft });

const LOANS = list([
  row('r1', { name: 'Grad PLUS', balance: 1000, rate: 9, due: '2026-12-18' }),
  row('r2', { name: 'Direct', balance: 250.5, rate: 8, due: '2026-12-19' }),
  row('r3', { name: 'Found in Gmail', balance: 9999, due: '2026-11-05' }, true),
]);

const metric: Metric = {
  id: METRIC,
  goalId: 'g',
  name: 'Payments',
  source: 'list',
  collectionId: LIST,
  dateField: 'due',
  period: 'week',
  target: 2,
  position: 0,
};

function data(over: Partial<DashboardData> = {}): DashboardData {
  return {
    today: '2026-11-03',
    lists: [LOANS],
    metrics: [
      {
        ...metric,
        counts: [
          { startsOn: '2026-10-26', endsOn: '2026-11-02', count: 1 },
          { startsOn: '2026-11-02', endsOn: '2026-11-09', count: 3 },
        ],
      },
    ],
    steps: [{ id: STEP, title: 'Send the form', dueOn: '2026-11-10', status: 'open', closedOn: null }],
    readings: [],
    ...over,
  };
}

function view(tile: Tile, d: DashboardData = data()) {
  const context: DashboardContext = {
    lists: d.lists,
    metrics: d.metrics,
    stepIds: new Set(d.steps.map((s) => s.id)),
  };
  return tileView(tile, 0, tileProblem(tile, context), d);
}

describe('number tiles', () => {
  it('adds up a money field over the confirmed rows, leaving drafts out', () => {
    const v = view({ type: 'number', list: LIST, field: 'balance' });
    expect(v.body).toMatchObject({ type: 'number', value: '$1,250.50', caption: '2 in Loans, added up' });
    expect(v.title).toBe('Balance');
    // A tracked field takes a new reading on one of the rows.
    expect(v.add).toMatchObject({
      kind: 'reading',
      label: 'Log balances',
      rowLabel: 'Loan',
      rows: [{ id: 'r1', input: '$1,000' }, { id: 'r2', input: '$250.50' }],
    });
  });

  it('counts the rows without a field', () => {
    const v = view({ type: 'number', title: 'Loans left', list: LIST });
    expect(v.body).toMatchObject({ value: '2', caption: 'In Loans' });
    expect(v.add).toMatchObject({ kind: 'row', fields: [{ key: 'name' }] });
  });

  it("reads a metric's latest period with its aim", () => {
    const v = view({ type: 'number', metric: METRIC });
    expect(v.body).toMatchObject({ value: '3', caption: 'This week · target 2 a week' });
    expect(v.add).toMatchObject({ kind: 'row', fields: [{ key: 'name' }, { key: 'due' }] });
  });

  it('says what it will show when the list is empty', () => {
    const v = view({ type: 'number', list: LIST, field: 'balance' }, data({ lists: [list([])] }));
    expect(v.body).toBeNull();
    expect(v.empty).toBe('No balance in Loans yet. Each one you add counts toward the total.');
    // With no rows a tracked field starts with a row.
    expect(v.add).toMatchObject({ kind: 'row' });
  });
});

describe('countdown tiles', () => {
  it("counts down to a step's date", () => {
    const v = view({ type: 'countdown', step: STEP });
    expect(v.body).toMatchObject({ type: 'countdown', days: 7, date: '2026-11-10' });
    expect(v.add).toBeNull();
  });

  it('takes the soonest date ahead on a confirmed row, and names the one after', () => {
    const v = view({ type: 'countdown', list: LIST, field: 'due' });
    expect(v.body).toMatchObject({ days: 45, date: '2026-12-18', caption: '18 Dec · Grad PLUS, then 19 Dec' });
    expect(v.title).toBe('Next due');
  });

  it('is empty when no date is ahead, and when a step has none', () => {
    const past = data({ today: '2027-01-01' });
    expect(view({ type: 'countdown', list: LIST, field: 'due' }, past).empty).toBe('No due ahead in Loans. Add one and this counts down to it.');
    const bare = data({ steps: [{ id: STEP, title: 'Send the form', dueOn: null, status: 'open', closedOn: null }] });
    expect(view({ type: 'countdown', step: STEP }, bare).empty).toBe('It has no date yet. Give it one and this counts down to it.');
  });

  it('words the days', () => {
    expect(countdownWords(0)).toBe('Today');
    expect(countdownWords(1)).toBe('Tomorrow');
    expect(countdownWords(45)).toBe('45 days');
    expect(countdownWords(-1)).toBe('1 day late');
    expect(daysBetween('2026-11-03', '2026-12-18')).toBe(45);
  });
});

describe('chart tiles', () => {
  it("adds each row's latest reading into one point a day", () => {
    const readings = [
      { recordId: 'r1', field: 'balance', value: 1100, readOn: '2026-09-01' },
      { recordId: 'r2', field: 'balance', value: 300, readOn: '2026-09-02' },
      { recordId: 'r1', field: 'balance', value: 1000, readOn: '2026-10-01' },
      { recordId: 'r1', field: 'rate', value: 9, readOn: '2026-10-01' },
      { recordId: 'r3', field: 'balance', value: 9999, readOn: '2026-10-01' },
    ];
    expect(combinedSeries(LOANS, 'balance', readings)).toEqual([
      { on: '2026-09-01', value: 1100 },
      { on: '2026-09-02', value: 1400 },
      { on: '2026-10-01', value: 1300 },
    ]);
    const v = view({ type: 'chart', style: 'line', list: LIST, field: 'balance' }, data({ readings }));
    expect(v.body).toMatchObject({ type: 'chart', style: 'line', bars: null });
    expect(v.body && 'summary' in v.body && v.body.summary).toBe('$1,300 on 1 Oct, from $1,100 on 1 Sep 2026 · 2 in Loans, added up');
  });

  it("draws a metric's periods with its target", () => {
    const v = view({ type: 'chart', style: 'bar', metric: METRIC });
    expect(v.body).toMatchObject({ style: 'bar', target: { value: 2, label: 'Target 2 a week' }, period: 'week' });
  });

  it('is empty before anything is logged', () => {
    const v = view({ type: 'chart', style: 'line', list: LIST, field: 'balance' });
    expect(v.empty).toBe('No balances logged yet. Each balance you log draws here as a point on the line.');
  });
});

describe('table tiles', () => {
  it('shows the named columns of the confirmed rows', () => {
    const v = view({ type: 'table', list: LIST, fields: ['name', 'balance'] });
    expect(v.body).toMatchObject({ type: 'table', columns: [{ key: 'name' }, { key: 'balance' }], more: 0 });
    expect(v.body && v.body.type === 'table' && v.body.rows.map((r) => r.id)).toEqual(['r1', 'r2']);
  });

  it('says how many more rows the list holds', () => {
    const many = list(Array.from({ length: TABLE_ROWS_MAX + 3 }, (_, i) => row(`m${i}`, { name: `Loan ${i}` })));
    const v = view({ type: 'table', list: LIST }, data({ lists: [many] }));
    expect(v.body).toMatchObject({ more: 3 });
  });
});

describe('broken tiles', () => {
  it('names what is missing and draws no body or add', () => {
    const v = view({ type: 'table', title: 'Loans', list: LIST, fields: ['servicer'] });
    expect(v).toMatchObject({ problem: 'The list Loans has no field "servicer".', body: null, add: null });
    const id = '44444444-4444-4444-8444-444444444444';
    const gone = view({ type: 'number', list: id });
    expect(gone).toMatchObject({ title: 'Number', problem: 'The list it reads is not on this goal.' });
    // A list archived since is named.
    const named = view({ type: 'number', list: id }, data({ goneLists: { [id]: 'Savings' } }));
    expect(named.problem).toBe('The list Savings is no longer on this goal.');
  });
});
