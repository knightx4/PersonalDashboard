import { DashboardTiles } from '@/app/goals/[goalId]/dashboard-tiles';
import type { CollectionField } from '@/lib/goals/collections';
import { tileProblem, type DashboardContext, type Tile } from '@/lib/goals/dashboard';
import {
  tileView,
  type DashboardData,
  type TileList,
  type TileReading,
  type TileStep,
  type TileView,
} from '@/lib/goals/dashboard-tiles';
import { countByPeriod, type Metric } from '@/lib/goals/metrics';

/**
 * A goal's dashboard tiles drawn from fixtures for the gallery (plan
 * #2778.2): a loans goal with a total, two countdowns, a line of the
 * balances, a bar chart of a metric and the loans as a table. Every view
 * goes through tileProblem and tileView, as the page's do, so what is drawn
 * is what those rows would give on 3 Nov 2026. The lender, the loans and the
 * amounts are made up.
 *
 * Plan #2778.3 adds the loans goal's repayment-plan tracker, an apartment
 * goal's rooms (a parts tile) and a graduate programs goal's slots and grid,
 * each shaped like the real goal and with every name and date made up.
 */

const TODAY = '2026-11-03';
const NOW = new Date('2026-11-03T12:00:00Z');
const GOAL = 'f0000000-0000-4000-8000-000000000001';

const LOANS_ID = 'a0000000-0000-4000-8000-000000000001';
const PAYMENTS_ID = 'a0000000-0000-4000-8000-000000000002';
const METRIC_ID = 'b0000000-0000-4000-8000-000000000001';
const STEP_ID = 'c0000000-0000-4000-8000-000000000001';
const BARE_STEP_ID = 'c0000000-0000-4000-8000-000000000002';

/** A step under `parentId` (the goal unless named), open with no date unless told otherwise. */
function step(id: string, title: string, over: Partial<TileStep> = {}): TileStep {
  return { id, title, dueOn: null, status: 'open', closedOn: null, parentId: GOAL, position: 0, ...over };
}

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

/** A made-up repayment-plan application: five checkpoints done, two to go. */
const PLAN_DONE: [string, string][] = [
  ['Decide whether to switch repayment plans', '2026-10-29'],
  ['Write a walkthrough of the application form', '2026-11-02'],
  ['Send the application online', '2026-11-02'],
  ['Draft a call script for the servicer', '2026-11-02'],
  ['Check that no bill comes due while it is processed', '2026-11-03'],
];
const planId = (i: number) => `c0000000-0000-4000-8000-00000000010${i}`;
const PLAN_IDS = [...PLAN_DONE.map((_, i) => planId(i)), STEP_ID, BARE_STEP_ID];

const DATA: DashboardData = {
  goalId: GOAL,
  today: TODAY,
  lists: [LOAN_LIST, PAYMENT_LIST],
  metrics: [{ ...METRIC, counts: counts(PAYMENT_LIST) }],
  steps: [
    ...PLAN_DONE.map(([title, closedOn], i) => step(planId(i), title, { status: 'done', closedOn, position: i })),
    step(STEP_ID, 'Save the approval letter showing the $0 payment', { dueOn: '2026-11-20', position: 10 }),
    step(BARE_STEP_ID, 'Recertify income for the repayment plan', { position: 11 }),
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
  { type: 'slots', title: 'Loans paid off', list: LOANS_ID, count: 4 },
  { type: 'rooms', title: 'Parts of the plan' },
  { type: 'tracker', parent: BARE_STEP_ID },
  { type: 'grid', title: 'Loan paperwork', list: LOANS_ID, fields: ['name', 'rate', 'first_bill'] },
];

const GONE = 'a0000000-0000-4000-8000-0000000000ff';
const GONE_STEP = 'c0000000-0000-4000-8000-0000000000ff';

/** Tiles whose sources have gone or changed since they were laid out. */
const BROKEN_TILES: Tile[] = [
  { type: 'number', title: 'Total saved', list: GONE, field: 'amount' },
  { type: 'countdown', title: 'Next bill', list: LOANS_ID, field: 'rate' },
  { type: 'chart', style: 'line', title: 'Rate over time', list: LOANS_ID, field: 'rate' },
  { type: 'table', title: 'Loans', list: LOANS_ID, fields: ['name', 'servicer'] },
  { type: 'slots', title: 'Loans paid off', list: LOANS_ID, count: 4, field: 'rate' },
  { type: 'rooms', title: 'Rooms', parent: GONE_STEP },
  { type: 'tracker', title: 'Repayment plan application', steps: [STEP_ID, GONE_STEP] },
  { type: 'grid', title: 'Loan paperwork', list: LOANS_ID, fields: ['name', 'signed'] },
];

/** The loans goal with its repayment-plan application as a tracker under the table (plan #2778.3). */
const LOANS_TILES: Tile[] = [...TILES, { type: 'tracker', title: 'Repayment plan application', steps: PLAN_IDS }];

export function GoalDashboardTilesSurface() {
  return <DashboardTiles goalId={GOAL} views={views(LOANS_TILES, DATA)} />;
}

/** The loans goal's id and its tiles, for the whole goal page in the gallery (plan #2778.4). */
export const LOANS_GOAL_ID = GOAL;

/** The loans goal's tiles as on its Dashboard: the figures, the line of the balance, the table and the tracker. */
export function loansDashboardViews(): TileView[] {
  return views(
    LOANS_TILES.filter((tile) => !(tile.type === 'chart' && tile.style === 'bar')),
    DATA,
  );
}

// ---------------------------------------------------------------------------
// An apartment goal (plan #2778.3): a card per room, each with its steps.
// Shaped like a real tidying goal (how many rooms, how many steps in each,
// one room planned in sub-parts), with every title and date made up.
// ---------------------------------------------------------------------------

const HOME_TODAY = '2026-11-04';
const HOME = 'f0000000-0000-4000-8000-000000000002';

type RoomFixture = {
  name: string;
  done: number;
  last: string | null;
  /** Its open steps in plan order; one given as [title, sub-part] sits in a sub-part. */
  open: (string | [string, string])[];
};

const ROOMS: RoomFixture[] = [
  { name: 'Kitchen', done: 6, last: '2026-10-27', open: ['Assemble the rolling cart', 'Move the jars and bottles onto the cart'] },
  {
    name: 'Living room',
    done: 16,
    last: '2026-11-04',
    open: ['Carry the storage bins to the cupboard', 'Measure the wall for the shelves', 'Assemble the shelves', 'Lay the rug down', 'Hang the two frames', 'Find a home for the cables', 'Clear the window sill', 'Wipe down the coffee table', 'Return the spare lamp'],
  },
  {
    name: 'Study',
    done: 12,
    last: '2026-11-04',
    open: [
      ['Choose drawers for the closet', 'Closet'],
      'Slide the corner desk to the window',
      ['Measure the free wall', 'Measurements'],
      ['Measure where the desk will sit', 'Measurements'],
      'Put the printer on the low shelf',
      ['Hang the closet rail', 'Closet'],
      'Sort the paper tray',
    ],
  },
  { name: 'Bedroom', done: 6, last: '2026-11-04', open: ['Agree with Alex where the vanity things go', 'Empty the two bins under the bed'] },
  { name: 'Main bathroom', done: 3, last: '2026-11-04', open: ['Agree with Alex how the shelving is arranged'] },
  { name: 'Laundry closet', done: 2, last: '2026-11-04', open: ['Move what is stored in front of the machines', 'Clear the closet floor', 'Put the supplies on one shelf'] },
  { name: 'Coat closet', done: 4, last: '2026-11-04', open: [] },
  { name: 'Hallway', done: 3, last: '2026-11-04', open: [] },
  { name: 'Guest bathroom', done: 0, last: null, open: ['Clear the counter', 'Sort what was on the counter', 'Give each kept thing a spot', 'Replace the shower curtain'] },
];

const roomId = (i: number) => `90000000-0000-4000-8000-0000000000${String(i).padStart(2, '0')}`;
const leafId = (room: number, n: number) => `91000000-0000-4000-8000-0000000${String(room).padStart(2, '0')}${String(n).padStart(3, '0')}`;
const subId = (room: number, n: number) => `92000000-0000-4000-8000-0000000${String(room).padStart(2, '0')}${String(n).padStart(3, '0')}`;

function roomSteps(): TileStep[] {
  const steps: TileStep[] = [];
  ROOMS.forEach((room, r) => {
    steps.push(step(roomId(r), room.name, { parentId: HOME, position: r }));
    // The sub-parts a room is planned in, each a step of its own.
    const subs = [...new Set(room.open.flatMap((o) => (Array.isArray(o) ? [o[1]] : [])))];
    subs.forEach((name, s) => {
      // A sub-part sits in the plan where its first step would.
      const at = room.open.findIndex((o) => Array.isArray(o) && o[1] === name);
      steps.push(step(subId(r, s), name, { parentId: roomId(r), position: 50 + at }));
    });
    for (let d = 0; d < room.done; d++) {
      steps.push(
        step(leafId(r, d), `Done step ${d + 1}`, {
          parentId: roomId(r),
          position: d,
          status: 'done',
          closedOn: d === room.done - 1 ? room.last : '2026-10-03',
        }),
      );
    }
    room.open.forEach((o, n) => {
      const [title, sub] = Array.isArray(o) ? o : [o, null];
      steps.push(
        step(leafId(r, 500 + n), title, {
          parentId: sub ? subId(r, subs.indexOf(sub)) : roomId(r),
          position: 50 + n,
          dueOn: n === 0 && r === 0 ? '2026-11-08' : null,
        }),
      );
    });
  });
  // A lone step at the top is not a room; a dropped room is left out.
  steps.push(step('93000000-0000-4000-8000-000000000001', 'Shortlist three narrow dressers', { parentId: HOME, position: 40, status: 'done', closedOn: '2026-10-21' }));
  steps.push(step('93000000-0000-4000-8000-000000000002', 'Choose and build the furniture', { parentId: HOME, position: 41, status: 'dropped' }));
  return steps;
}

const HOME_DATA: DashboardData = { goalId: HOME, today: HOME_TODAY, lists: [], metrics: [], steps: roomSteps(), readings: [] };
const HOME_TILES: Tile[] = [{ type: 'rooms', title: 'Rooms' }];

/** The apartment's rooms, each card with its ring and next step. */
export function GoalDashboardTilesApartmentSurface() {
  return <DashboardTiles goalId={HOME} views={views(HOME_TILES, HOME_DATA)} />;
}

/** The study's card pressed: its open steps listed in place, the ones in a sub-part named under them. */
export function GoalDashboardTilesApartmentOpenSurface() {
  return <DashboardTiles goalId={HOME} views={views(HOME_TILES, HOME_DATA)} seams={{ held: { tile: 0, at: 2 } }} />;
}

// ---------------------------------------------------------------------------
// A graduate programs goal (plan #2778.3): slots for the letters and the
// applications sent, the next deadline, and a grid of programs by what each
// still needs. The programs, people and dates are made up.
// ---------------------------------------------------------------------------

const SCHOOL = 'f0000000-0000-4000-8000-000000000003';
const PROGRAMS_ID = 'a0000000-0000-4000-8000-000000000011';
const LETTERS_ID = 'a0000000-0000-4000-8000-000000000012';

const PROGRAM_FIELDS: CollectionField[] = [
  { key: 'name', label: 'Program', type: 'text' },
  { key: 'degree', label: 'Degree', type: 'choice', options: ["Master's", 'PhD'] },
  { key: 'deadline', label: 'Deadline', type: 'date' },
  { key: 'statement', label: 'Statement', type: 'yes_no' },
  { key: 'letters', label: 'Letters in', type: 'yes_no' },
  { key: 'fee', label: 'Fee paid', type: 'yes_no' },
  { key: 'sent', label: 'Sent', type: 'yes_no' },
];

const PROGRAMS: [string, string, string | null, boolean, boolean, boolean, boolean][] = [
  ['Northfield University Economics PhD', 'PhD', '2026-12-08', true, true, true, true],
  ['Lakeshore Institute Economics MA', "Master's", '2026-12-15', true, true, false, false],
  ['Eastbrook Applied Economics MA', "Master's", '2027-01-05', true, false, false, false],
  ['Ridgemont College Economics PhD', 'PhD', '2026-12-15', false, false, false, false],
  ['Westvale University Quantitative Economics MA (two-year track)', "Master's", '2027-01-15', true, true, true, true],
  ['Harbor City Economics MA', "Master's", null, false, false, false, false],
  ['Predoctoral research assistant, a regional reserve bank', 'PhD', '2026-12-31', true, false, false, false],
];

const PROGRAM_LIST: TileList = {
  id: PROGRAMS_ID,
  name: 'Programs',
  fields: PROGRAM_FIELDS,
  records: [
    ...PROGRAMS.map(([name, degree, deadline, statement, letters, fee, sent], i) => ({
      id: `e1000000-0000-4000-8000-00000000000${i}`,
      data: { name, degree, deadline, statement, letters, fee, sent },
      draft: false,
    })),
    // Found by Dash and not yet confirmed: left out of every count.
    { id: 'e1000000-0000-4000-8000-0000000000ff', data: { name: 'A program Dash found', sent: true }, draft: true },
  ],
};

const LETTER_LIST: TileList = {
  id: LETTERS_ID,
  name: 'Recommenders',
  fields: [
    { key: 'name', label: 'Recommender', type: 'text' },
    { key: 'agreed', label: 'Agreed', type: 'yes_no' },
  ],
  records: [
    { id: 'e2000000-0000-4000-8000-000000000001', data: { name: 'Prof. Okafor', agreed: true }, draft: false },
    { id: 'e2000000-0000-4000-8000-000000000002', data: { name: 'Dr. Lindqvist', agreed: true }, draft: false },
    { id: 'e2000000-0000-4000-8000-000000000003', data: { name: 'Ms. Ferreira', agreed: false }, draft: false },
  ],
};

const SCHOOL_DATA: DashboardData = {
  goalId: SCHOOL,
  today: TODAY,
  lists: [PROGRAM_LIST, LETTER_LIST],
  metrics: [],
  steps: [],
  readings: [],
};

const SCHOOL_TILES: Tile[] = [
  { type: 'slots', title: 'Letters agreed', list: LETTERS_ID, count: 3, field: 'agreed' },
  { type: 'slots', title: 'Applications sent', list: PROGRAMS_ID, count: 8, field: 'sent' },
  { type: 'countdown', title: 'Next deadline', list: PROGRAMS_ID, field: 'deadline' },
  { type: 'grid', title: 'Programs', list: PROGRAMS_ID, fields: ['name', 'deadline', 'statement', 'letters', 'fee', 'sent'] },
];

/** The programs goal: two slot rows, a countdown, and the grid of programs. */
export function GoalDashboardTilesProgramsSurface() {
  return <DashboardTiles goalId={SCHOOL} views={views(SCHOOL_TILES, SCHOOL_DATA)} />;
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
