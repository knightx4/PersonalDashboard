import { parentBy, type ModuleSources } from '@/lib/sources/types';

/**
 * Finances' tables, as Goals reads them (lib/sources/types.ts). The accounts
 * they hold, what they spent and what they own are sources; the Plaid sign-ins
 * and the daily balance readings are bookkeeping behind them.
 *
 * No row has a page yet: #2593.6 adds the account pages and gives these an
 * href and a section of the Finances nav.
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
    },
  ],
  notSources: [
    { table: 'finances.links', reason: 'Plaid sign-ins and sync state.' },
    { table: 'finances.balance_readings', reason: 'Daily balances, read through finances.accounts.' },
  ],
};
