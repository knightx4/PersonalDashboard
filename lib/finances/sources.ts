import { parentBy, type ModuleSources, type Section } from '@/lib/sources/types';

const ACCOUNTS: Section = { href: '/finances/accounts', label: 'Accounts' };
const FINANCES: Section = { href: '/finances', label: 'Finances' };

/** A transaction or a holding opens on its account's page. */
const onAccountPage = (title: string) => ({
  title,
  href: (row: Readonly<Record<string, unknown>>) =>
    typeof row.account_id === 'string' ? `/finances/accounts/${row.account_id}` : null,
  reads: ['account_id'],
  section: null,
  parent: parentBy('account_id', 'finances.accounts'),
});

/**
 * Finances' tables, as Goals reads them (lib/sources/types.ts). The accounts
 * they hold, what they spent and what they own are sources; the Plaid sign-ins
 * and the daily balance readings are bookkeeping behind them.
 *
 * An account opens on its own page under Accounts (plan #2593.6), and a
 * transaction or a holding on its account's.
 */
export const financesSources: ModuleSources = {
  sources: [
    {
      table: 'finances.accounts',
      module: 'Finances',
      holds: 'Their bank, card, brokerage and loan accounts, with credit limits and loan terms.',
      weight: 'record',
      search: ['name', 'official_name', 'institution_name'],
      title: 'name',
      facts: [
        'kind',
        'source',
        'credit_limit_cents',
        'interest_rate',
        'minimum_payment_cents',
        'next_payment_due_on',
        'closed_on',
      ],
      href: (id) => `/finances/accounts/${id}`,
      section: ACCOUNTS,
      note: 'Balances are in finances.balance_readings by account_id, one a day; for a credit card or a loan the balance is the amount owed.',
    },
    {
      table: 'finances.transactions',
      module: 'Finances',
      holds: 'Money into and out of their accounts: purchases, payments, transfers and pay.',
      weight: 'record',
      search: ['description', 'merchant', 'category'],
      title: 'description',
      facts: ['amount_cents', 'posted_on', 'pending'],
      newest: 'posted_on',
      parent: parentBy('account_id', 'finances.accounts'),
      page: onAccountPage('description'),
      note: 'amount_cents is negative for money out and positive for money in. A card payment shows on both the bank account and the card.',
    },
    {
      table: 'finances.holdings',
      module: 'Finances',
      holds: 'The investments in their brokerage accounts, with quantity, value and cost basis on a date.',
      weight: 'record',
      search: ['security_name', 'ticker'],
      title: 'security_name',
      facts: ['quantity', 'value_cents', 'cost_basis_cents', 'as_of'],
      newest: 'as_of',
      parent: parentBy('account_id', 'finances.accounts'),
      page: onAccountPage('security_name'),
    },
    {
      table: 'finances.month_reviews',
      module: 'Finances',
      holds: 'What Dash wrote about each month of their money: spending against the months before, new and changed subscriptions, unusual charges, interest, payments coming due and net worth.',
      weight: 'incidental',
      search: ['summary', 'lines'],
      title: 'month',
      newest: 'month',
      facts: ['status', 'source'],
      href: () => '/finances',
      section: FINANCES,
      note: "The summary and lines are Dash's, not theirs: each line is {id, kind, text, transaction_ids, account_ids}, the finances.transactions and finances.accounts rows behind it. month is the first day of the month reviewed. status 'failed' means the run broke (error says how); source 'plain' means no model worded it.",
    },
  ],
  notSources: [
    { table: 'finances.links', reason: 'Plaid sign-ins and sync state.' },
    { table: 'finances.balance_readings', reason: 'Daily balances, read through finances.accounts.' },
    { table: 'finances.plaid_events', reason: 'Webhooks Plaid sent, kept for the sync.' },
  ],
};
