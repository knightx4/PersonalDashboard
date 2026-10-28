import { AccountView } from '@/app/finances/accounts/account-view';
import type { ImportPhase } from '@/app/finances/settings/imports';
import { FinancesSettingsView } from '@/app/finances/settings/settings-view';
import { summarize, type AccountRow, type Reading } from '@/lib/finances/accounts';
import type { AccountTransaction } from '@/lib/finances/accounts-store';
import type { ImportPreview } from '@/lib/finances/import/store';
import {
  ACCOUNT_IDS,
  ACCOUNT_THREAD,
  ACCOUNTS_TODAY,
  FIXTURE_ACCOUNTS,
  FIXTURE_HOLDINGS,
  FIXTURE_READINGS,
} from './finances-accounts-fixtures';
import { FINANCES_LINKS } from './finances-settings-fixtures';

/**
 * Accounts Plaid cannot reach (plan #2593.5), from fixtures: Apple Card from
 * Wallet's statement export, a savings account and a car loan kept by hand,
 * the import's preview, empty and error states, the add-account popover, a
 * manual account's page asking for a new balance, and its Add balance
 * popover.
 */

const base = {
  officialName: null,
  linkId: null,
  mask: null,
  creditLimitCents: null,
  interestRate: null,
  minimumPaymentCents: null,
  nextPaymentDueOn: null,
  statementBalanceCents: null,
  closedOn: null,
} as const;

const APPLE_CARD_ID = '00000000-0000-4000-8000-000000000205';
const SAVINGS_ID = '00000000-0000-4000-8000-000000000301';
const CAR_LOAN_ID = '00000000-0000-4000-8000-000000000302';

const KEPT_ROWS: AccountRow[] = [
  FIXTURE_ACCOUNTS.find((a) => a.id === APPLE_CARD_ID)!,
  {
    ...base,
    id: SAVINGS_ID,
    name: 'Online Savings Account',
    institutionName: 'Ally Bank',
    kind: 'savings',
    source: 'manual',
  },
  {
    ...base,
    id: CAR_LOAN_ID,
    name: 'Auto loan',
    institutionName: 'Golden 1 Credit Union',
    kind: 'loan',
    source: 'manual',
  },
];

const KEPT_READINGS: Reading[] = [
  ...FIXTURE_READINGS.filter((r) => r.accountId === APPLE_CARD_ID),
  { accountId: SAVINGS_ID, readOn: '2026-06-30', balanceCents: 1_420_000 },
  { accountId: SAVINGS_ID, readOn: '2026-07-31', balanceCents: 1_446_310 },
  { accountId: SAVINGS_ID, readOn: '2026-09-12', balanceCents: 1_482_655 },
  { accountId: CAR_LOAN_ID, readOn: '2026-10-15', balanceCents: 1_184_220 },
];

const KEPT = summarize(KEPT_ROWS, KEPT_READINGS, [], ACCOUNTS_TODAY);

const CSV_PREVIEW: ImportPreview = {
  accountId: APPLE_CARD_ID,
  format: 'csv',
  count: 43,
  newCount: 41,
  from: '2026-09-01',
  to: '2026-09-30',
  closingOn: '2026-09-30',
  closingBalanceCents: 61_877,
  closingFrom: 'worked out',
};

const EMPTY_PREVIEW: ImportPreview = {
  accountId: APPLE_CARD_ID,
  format: 'csv',
  count: 0,
  newCount: 0,
  from: null,
  to: null,
  closingOn: null,
  closingBalanceCents: null,
  closingFrom: null,
};

const FILE = 'Apple Card Transactions - September 2026.csv';

const PHASES: Record<'preview' | 'empty' | 'error', ImportPhase> = {
  preview: { kind: 'preview', fileName: FILE, text: '', preview: CSV_PREVIEW },
  empty: {
    kind: 'preview',
    fileName: 'Apple Card Transactions - August 2026.csv',
    text: '',
    preview: EMPTY_PREVIEW,
  },
  error: {
    kind: 'error',
    fileName: 'Chase3381_Activity_20261028.CSV',
    message:
      'It is not an Apple Card export. Wallet exports it as a CSV with Transaction Date, Clearing Date, Description and Amount (USD) columns, or as an OFX card statement.',
  },
};

/** Finances settings with the imports section, an import held at one of its parts when asked. */
export function FinancesImportsSurface({
  phase,
  addOpen = false,
  empty = false,
}: {
  phase?: keyof typeof PHASES;
  addOpen?: boolean;
  empty?: boolean;
}) {
  return (
    <FinancesSettingsView
      links={empty ? [] : FINANCES_LINKS}
      itemsUsed={empty ? 0 : 2}
      configured
      kept={empty ? [] : KEPT}
      today={ACCOUNTS_TODAY}
      importPhase={phase ? PHASES[phase] : undefined}
      addOpen={addOpen}
    />
  );
}

const APPLE_TRANSACTIONS: AccountTransaction[] = [
  {
    id: 'a1',
    postedOn: '2026-09-30',
    description: 'UBER *EATS 8005928996 CA',
    merchant: 'Uber Eats',
    category: 'Food and drink',
    amountCents: -3_412,
    pending: false,
  },
  {
    id: 'a2',
    postedOn: '2026-09-28',
    description: 'APPLE.COM/BILL ONE APPLE PARK WAY 866-712-7753 CUPERTINO 95014 CA USA',
    merchant: 'Apple Services',
    category: 'Shopping',
    amountCents: -1_999,
    pending: false,
  },
  {
    id: 'a3',
    postedOn: '2026-09-26',
    description: 'ACH DEPOSIT INTERNET TRANSFER FROM ACCOUNT ENDING IN 4417',
    merchant: null,
    category: 'Card payment',
    amountCents: 52_000,
    pending: false,
  },
  {
    id: 'a4',
    postedOn: '2026-09-21',
    description: 'WALGREENS #5520 SAN FRANCISCO CA',
    merchant: 'Walgreens',
    category: 'Medical',
    amountCents: -2_786,
    pending: false,
  },
];

/** One account kept another way: Apple Card from imports, or a manual account asking for its balance. */
export function FinancesKeptAccountSurface({
  kind,
  readingOpen = false,
}: {
  kind: 'import' | 'manual' | 'goals';
  readingOpen?: boolean;
}) {
  const id = kind === 'import' ? APPLE_CARD_ID : kind === 'manual' ? SAVINGS_ID : ACCOUNT_IDS.loan;
  const rows = kind === 'goals' ? FIXTURE_ACCOUNTS : KEPT_ROWS;
  const readings = kind === 'goals' ? FIXTURE_READINGS : KEPT_READINGS;
  const [account] = summarize(
    [rows.find((a) => a.id === id)!],
    readings,
    FIXTURE_HOLDINGS,
    ACCOUNTS_TODAY,
  );
  return (
    <AccountView
      account={account}
      readings={readings.filter((r) => r.accountId === id)}
      holdings={[]}
      transactions={kind === 'import' ? APPLE_TRANSACTIONS : []}
      moreTransactions={false}
      thread={ACCOUNT_THREAD}
      today={ACCOUNTS_TODAY}
      goalId={kind === 'goals' ? '00000000-0000-4000-8000-0000000009a1' : null}
      readingOpen={readingOpen}
    />
  );
}
