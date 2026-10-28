import type { DevComment } from '@/lib/comments/load';
import type { ReviewCharge, ReviewPanel, ShownLine, ShownReview } from '@/lib/finances/review/show';
import { ACCOUNTS_TODAY } from './finances-accounts-fixtures';

/**
 * The monthly money review's fixtures (plan #2593.8.3): September 2026 as
 * Dash wrote it on 1 October for the accounts in
 * finances-accounts-fixtures.ts, with every kind of line, the longest a
 * line gets, a quiet month, a failed run with and without the code's
 * sentences, and the line before the first review.
 */

const account = (n: number) => `00000000-0000-4000-8000-0000000002${String(n).padStart(2, '0')}`;
const SAPPHIRE = account(3);
const FREEDOM = account(4);
const APPLE = account(5);
const CHECKING = account(1);

let next = 0;
const charge = (
  accountId: string,
  postedOn: string,
  name: string,
  amountCents: number,
  pending = false,
): ReviewCharge => ({
  id: `00000000-0000-4000-8000-00000000f${String(next++).padStart(3, '0')}`,
  accountId,
  postedOn,
  name,
  amountCents,
  pending,
});

const FOOD: ReviewCharge[] = [
  charge(SAPPHIRE, '2026-09-27', 'Lilia', -18_640),
  charge(SAPPHIRE, '2026-09-12', 'Whole Foods Market', -14_212),
  charge(FREEDOM, '2026-09-19', 'Trader Joe’s', -9_874),
  charge(SAPPHIRE, '2026-09-05', 'Whole Foods Market', -8_931),
  charge(APPLE, '2026-09-22', 'Sweetgreen', -1_895),
  charge(APPLE, '2026-09-15', 'Blue Bottle Coffee', -675),
  charge(FREEDOM, '2026-09-08', 'DoorDash', -4_322),
  charge(SAPPHIRE, '2026-09-29', 'Joe’s Pizza', -2_150, true),
];

const lines: ShownLine[] = [
  {
    id: 'spending',
    kind: 'spending',
    text: 'You spent $4,212.37 across 63 charges in September, against $3,480.10 a month over the three months before.',
    charges: [
      charge(SAPPHIRE, '2026-09-02', 'Delta Air Lines', -61_240),
      charge(FREEDOM, '2026-09-14', 'Apple Store', -54_900),
      charge(SAPPHIRE, '2026-09-27', 'Lilia', -18_640),
      charge(SAPPHIRE, '2026-09-12', 'Whole Foods Market', -14_212),
      charge(APPLE, '2026-09-09', 'Equinox', -26_500),
      charge(FREEDOM, '2026-09-19', 'Trader Joe’s', -9_874),
      charge(SAPPHIRE, '2026-09-05', 'Whole Foods Market', -8_931),
      charge(FREEDOM, '2026-09-08', 'DoorDash', -4_322),
    ],
    chargeCount: 63,
    totalCents: -421_237,
    accounts: [],
  },
  {
    id: 'category:food and drink',
    kind: 'category',
    text: 'Food and drink came to $606.99, up from $412.50 a month before, mostly two dinners out and the weekly shop.',
    charges: FOOD,
    chargeCount: FOOD.length,
    totalCents: FOOD.reduce((s, c) => s + c.amountCents, 0),
    accounts: [],
  },
  {
    id: 'changed_subscription:netflix',
    kind: 'changed_subscription',
    text: 'Netflix went from $15.49 to $17.99 a month.',
    charges: [charge(APPLE, '2026-09-18', 'Netflix', -1_799)],
    chargeCount: 1,
    totalCents: -1_799,
    accounts: [],
  },
  {
    id: 'unusual',
    kind: 'unusual',
    text: 'One charge stood out: $612.40 to Delta Air Lines on 2 September.',
    charges: [charge(SAPPHIRE, '2026-09-02', 'Delta Air Lines', -61_240)],
    chargeCount: 1,
    totalCents: -61_240,
    accounts: [],
  },
  {
    id: 'interest',
    kind: 'interest',
    text: 'You paid $38.12 in interest on Freedom Unlimited.',
    charges: [charge(FREEDOM, '2026-09-24', 'Interest charge on purchases', -3_812)],
    chargeCount: 1,
    totalCents: -3_812,
    accounts: [],
  },
  {
    id: `due:${APPLE}`,
    kind: 'due',
    text: 'Apple Card’s $618.77 statement is due on 31 October.',
    charges: [],
    chargeCount: 0,
    totalCents: 0,
    accounts: [{ id: APPLE, title: 'Apple Card' }],
  },
  {
    id: 'net_worth',
    kind: 'net_worth',
    text: 'Net worth rose $1,940.22 to $48,310.55 over September.',
    charges: [],
    chargeCount: 0,
    totalCents: 0,
    accounts: [
      { id: CHECKING, title: 'Total Checking ··4417' },
      { id: SAPPHIRE, title: 'Sapphire Preferred ··8812' },
      { id: account(6), title: 'Individual - TOD Brokerage Account ··2290' },
    ],
  },
];

const base: ShownReview = {
  id: '00000000-0000-4000-8000-0000000003a1',
  month: '2026-09',
  label: 'September 2026',
  state: 'written',
  summary:
    'September ran above the three months before it, mostly on one flight to Lisbon and a new phone.',
  lines,
  attempts: 1,
  gaveUp: false,
};

export const REVIEW_TODAY = ACCOUNTS_TODAY;

export const REVIEW_WRITTEN: NonNullable<ReviewPanel> = { kind: 'review', review: base };

/** The line whose popover the charges surface holds open. */
export const REVIEW_OPEN_LINE = 'category:food and drink';

/** The net worth line, whose popover lists the accounts behind it. */
export const REVIEW_ACCOUNTS_LINE = 'net_worth';

export const REVIEW_QUIET: NonNullable<ReviewPanel> = {
  kind: 'review',
  review: {
    ...base,
    state: 'quiet',
    summary: 'Nothing came through your accounts in September, so there is nothing to review.',
    lines: [],
  },
};

/** The run broke after the figures were worked out: the code's sentences are kept. */
export const REVIEW_FAILED: NonNullable<ReviewPanel> = {
  kind: 'review',
  review: {
    ...base,
    state: 'failed',
    attempts: 3,
    gaveUp: true,
    lines: lines.slice(0, 3).map((line) => ({ ...line })),
  },
};

export const REVIEW_FIRST: NonNullable<ReviewPanel> = {
  kind: 'first',
  label: 'October 2026',
  on: '2026-11-01',
};

export const REVIEW_THREAD: DevComment[] = [
  {
    id: '00000000-0000-4000-8000-0000000003c1',
    author: 'me',
    body: 'The Delta flight was for the wedding in Lisbon, so it will not repeat.',
    createdAt: '2026-10-02T08:14:00Z',
  },
];
