import type { LinkedInstitution } from '@/app/finances/settings/linked-accounts';
import {
  addDays,
  netWorthSeries,
  summarize,
  type AccountRow,
  type Holding,
  type Reading,
} from '@/lib/finances/accounts';
import type { AccountTransaction } from '@/lib/finances/accounts-store';
import type { DevComment } from '@/lib/comments/load';

/**
 * Finances accounts fixtures (plan #2593.6): Chase checking and savings,
 * both Chase cards, Apple Card from a statement import, a Fidelity brokerage
 * with the longest name Fidelity gives, and two student loans, one read from
 * Goals. A year of readings, drawn so the net worth line has a shape: pay
 * coming in, a card paid down, the brokerage rising, the loans falling.
 */
export const ACCOUNTS_TODAY = '2026-10-28';

const base = {
  officialName: null,
  linkId: null,
  creditLimitCents: null,
  interestRate: null,
  minimumPaymentCents: null,
  nextPaymentDueOn: null,
  statementBalanceCents: null,
  closedOn: null,
} as const;

/** Chase's Plaid link, behind checking, savings and both cards. */
const CHASE_LINK = '00000000-0000-4000-8000-0000000000c1';

const id = (n: number) => `00000000-0000-4000-8000-0000000002${String(n).padStart(2, '0')}`;

export const FIXTURE_ACCOUNTS: AccountRow[] = [
  {
    ...base,
    id: id(1),
    linkId: CHASE_LINK,
    name: 'Total Checking',
    institutionName: 'Chase',
    mask: '4417',
    kind: 'checking',
    source: 'plaid',
  },
  {
    ...base,
    id: id(2),
    linkId: CHASE_LINK,
    name: 'Chase Savings',
    institutionName: 'Chase',
    mask: '9020',
    kind: 'savings',
    source: 'plaid',
  },
  {
    ...base,
    id: id(3),
    linkId: CHASE_LINK,
    name: 'Sapphire Preferred',
    institutionName: 'Chase',
    mask: '3381',
    kind: 'credit_card',
    source: 'plaid',
    creditLimitCents: 1_500_000,
    interestRate: 21.49,
    minimumPaymentCents: 4_000,
    nextPaymentDueOn: '2026-11-14',
    statementBalanceCents: 162_450,
  },
  {
    ...base,
    id: id(4),
    linkId: CHASE_LINK,
    name: 'Freedom Unlimited',
    institutionName: 'Chase',
    mask: '7752',
    kind: 'credit_card',
    source: 'plaid',
    creditLimitCents: 800_000,
    interestRate: 20.49,
    minimumPaymentCents: 3_500,
    nextPaymentDueOn: '2026-11-03',
    statementBalanceCents: 211_800,
  },
  {
    ...base,
    id: id(5),
    name: 'Apple Card',
    institutionName: 'Apple',
    mask: null,
    kind: 'credit_card',
    source: 'import',
    creditLimitCents: 600_000,
    nextPaymentDueOn: '2026-10-31',
    statementBalanceCents: 61_877,
  },
  {
    ...base,
    id: id(6),
    name: 'Individual - TOD Brokerage Account',
    institutionName: 'Fidelity Investments',
    mask: '1186',
    kind: 'brokerage',
    source: 'plaid',
  },
  {
    ...base,
    id: id(7),
    name: 'Direct Subsidized Loan',
    institutionName: 'Nelnet',
    mask: '0001',
    kind: 'loan',
    source: 'plaid',
    interestRate: 4.99,
    minimumPaymentCents: 21_450,
    nextPaymentDueOn: '2026-11-21',
  },
  {
    ...base,
    id: id(8),
    name: 'Direct Unsubsidized Loan',
    institutionName: 'Nelnet',
    mask: '0002',
    kind: 'loan',
    source: 'goals',
    interestRate: 6.54,
    minimumPaymentCents: 31_020,
    nextPaymentDueOn: '2026-11-21',
  },
];

/** A gentle wave, so a year of balances is not a ruler. */
const wave = (day: number, period: number, size: number) =>
  Math.round(Math.sin((day / period) * Math.PI * 2) * size);

function yearOfReadings(): Reading[] {
  // The statement balances read before the year starts, so both accounts
  // count from its first day.
  const out: Reading[] = [
    { accountId: id(8), readOn: '2025-10-20', balanceCents: 2_281_000 },
    { accountId: id(5), readOn: '2025-09-30', balanceCents: 52_000 },
  ];
  for (let d = 364; d >= 0; d -= 1) {
    const day = addDays(ACCOUNTS_TODAY, -d);
    const t = 364 - d;
    // Checking: pay on the 1st and 15th, spent down between.
    out.push({
      accountId: id(1),
      readOn: day,
      balanceCents: 640_000 + wave(t, 15, 40_000) + t * 300,
    });
    out.push({ accountId: id(2), readOn: day, balanceCents: 1_200_000 + t * 2_400 });
    // Cards build up over a month and drop when the statement is paid.
    out.push({ accountId: id(3), readOn: day, balanceCents: 90_000 + ((t + 12) % 30) * 5_500 });
    out.push({ accountId: id(4), readOn: day, balanceCents: 150_000 + ((t + 3) % 30) * 8_000 });
    out.push({
      accountId: id(6),
      readOn: day,
      balanceCents: 3_800_000 + t * 2_100 + wave(t, 45, 160_000),
    });
    out.push({ accountId: id(7), readOn: day, balanceCents: 1_150_000 - t * 520 });
    // Read from Goals once a month, on the statement day.
    if (day.endsWith('-20'))
      out.push({ accountId: id(8), readOn: day, balanceCents: 2_280_000 - t * 760 });
    // Apple Card arrives once a month, from the statement import.
    if (day.endsWith('-30'))
      out.push({ accountId: id(5), readOn: day, balanceCents: 55_000 + wave(t, 90, 20_000) });
  }
  // Chase's sign-in lapsed: Freedom has no reading for the last two days.
  return out.filter((r) => !(r.accountId === id(4) && r.readOn > addDays(ACCOUNTS_TODAY, -3)));
}

export const FIXTURE_READINGS = yearOfReadings();

export const FIXTURE_HOLDINGS: Holding[] = [
  {
    accountId: id(6),
    securityName: 'Vanguard Total Stock Market ETF',
    ticker: 'VTI',
    quantity: 98.412,
    valueCents: 2_812_300,
    costBasisCents: 2_204_000,
    asOf: '2026-10-27',
  },
  {
    accountId: id(6),
    securityName: 'Fidelity ZERO Large Cap Index Fund',
    ticker: 'FNILX',
    quantity: 610,
    valueCents: 1_120_400,
    costBasisCents: 980_000,
    asOf: '2026-10-27',
  },
  {
    accountId: id(6),
    securityName: 'Apple Inc.',
    ticker: 'AAPL',
    quantity: 12,
    valueCents: 302_100,
    costBasisCents: 330_500,
    asOf: '2026-10-27',
  },
  {
    accountId: id(6),
    securityName: 'Fidelity Government Money Market Fund',
    ticker: 'SPAXX',
    quantity: 312.5,
    valueCents: 31_250,
    costBasisCents: null,
    asOf: '2026-10-27',
  },
];

export const FIXTURE_COMMENTS = new Map([[id(3), 2]]);

export const ACCOUNTS = summarize(
  FIXTURE_ACCOUNTS,
  FIXTURE_READINGS,
  FIXTURE_HOLDINGS,
  ACCOUNTS_TODAY,
  FIXTURE_COMMENTS,
);
export const NET_WORTH = netWorthSeries(FIXTURE_ACCOUNTS, FIXTURE_READINGS, ACCOUNTS_TODAY);

/** The stale card, for the popover held open. */
export const STALE_ACCOUNT_ID = id(4);

export const ACCOUNT_IDS = { checking: id(1), card: id(3), brokerage: id(6), loan: id(8) };

export const NEEDS_SIGN_IN: LinkedInstitution[] = [
  {
    id: CHASE_LINK,
    institutionId: 'ins_56',
    institutionName: 'Chase',
    needsUpdate: true,
    lastError: null,
    linkedAt: '2026-10-21T15:04:00Z',
    lastSyncedAt: '2026-10-25T06:10:00Z',
    accounts: [],
  },
];

export const CARD_TRANSACTIONS: AccountTransaction[] = [
  {
    id: 't1',
    postedOn: '2026-10-28',
    description: 'SQ *BLUE BOTTLE COFFEE OAKLAND CA',
    merchant: 'Blue Bottle Coffee',
    category: 'Food and drink',
    amountCents: -675,
    pending: true,
  },
  {
    id: 't2',
    postedOn: '2026-10-27',
    description: 'AMAZON MKTPL*ZH4K21LP0 Amzn.com/bill WA',
    merchant: 'Amazon',
    category: 'Shopping',
    amountCents: -4_399,
    pending: false,
  },
  {
    id: 't3',
    postedOn: '2026-10-26',
    description: 'UNITED AIRLINES 0162345678901 HOUSTON TX',
    merchant: 'United Airlines',
    category: 'Travel',
    amountCents: -48_720,
    pending: false,
  },
  {
    id: 't4',
    postedOn: '2026-10-24',
    description: 'Payment Thank You-Mobile',
    merchant: null,
    category: 'Card payment',
    amountCents: 152_000,
    pending: false,
  },
  {
    id: 't5',
    postedOn: '2026-10-22',
    description: 'TRADER JOE S #123 SAN FRANCISCO CA',
    merchant: "Trader Joe's",
    category: 'Groceries',
    amountCents: -8_214,
    pending: false,
  },
  {
    id: 't6',
    postedOn: '2026-10-20',
    description: 'NETFLIX.COM 866-579-7172 CA',
    merchant: 'Netflix',
    category: 'Subscriptions',
    amountCents: -1_549,
    pending: false,
  },
  {
    id: 't7',
    postedOn: '2026-10-19',
    description: 'AMAZON MKTPL REFUND Amzn.com/bill WA',
    merchant: 'Amazon',
    category: 'Shopping',
    amountCents: 2_199,
    pending: false,
  },
];

export const LOAN_TRANSACTIONS: AccountTransaction[] = [
  {
    id: 'l1',
    postedOn: '2026-10-21',
    description: 'Scheduled payment',
    merchant: null,
    category: 'Loan payment',
    amountCents: 31_020,
    pending: false,
  },
  {
    id: 'l2',
    postedOn: '2026-09-21',
    description: 'Scheduled payment',
    merchant: null,
    category: 'Loan payment',
    amountCents: 31_020,
    pending: false,
  },
  {
    id: 'l3',
    postedOn: '2026-08-21',
    description: 'Scheduled payment',
    merchant: null,
    category: 'Loan payment',
    amountCents: 31_020,
    pending: false,
  },
];

export const ACCOUNT_THREAD: DevComment[] = [];

/** The same accounts with Chase's sign-in lapsed on 25 Oct: nothing read from it since. */
export const ACCOUNTS_SIGN_IN = summarize(
  FIXTURE_ACCOUNTS,
  FIXTURE_READINGS.filter(
    (r) =>
      !(
        FIXTURE_ACCOUNTS.find((a) => a.id === r.accountId)?.linkId === CHASE_LINK &&
        r.readOn > '2026-10-25'
      ),
  ),
  FIXTURE_HOLDINGS,
  ACCOUNTS_TODAY,
  FIXTURE_COMMENTS,
);

/** The accounts when their balances could not be read: names and details, no amounts. */
export const ACCOUNTS_NO_BALANCES = summarize(
  FIXTURE_ACCOUNTS,
  [],
  [],
  ACCOUNTS_TODAY,
  FIXTURE_COMMENTS,
);
