import { AccountView } from '@/app/finances/accounts/account-view';
import { AccountsView } from '@/app/finances/accounts/accounts-view';
import { summarize } from '@/lib/finances/accounts';
import {
  ACCOUNT_IDS,
  ACCOUNT_THREAD,
  ACCOUNTS,
  ACCOUNTS_NO_BALANCES,
  ACCOUNTS_SIGN_IN,
  ACCOUNTS_TODAY,
  CARD_TRANSACTIONS,
  FIXTURE_ACCOUNTS,
  FIXTURE_HOLDINGS,
  FIXTURE_READINGS,
  LOAN_TRANSACTIONS,
  NEEDS_SIGN_IN,
  NET_WORTH,
  STALE_ACCOUNT_ID,
} from './finances-accounts-fixtures';

/** Finances' Accounts page from fixtures (plan #2593.6), with a hidden part held open when asked. */
export function FinancesAccountsSurface({
  empty = false,
  chartActive,
  staleOpen = false,
  needsSignIn = false,
  readFailed = false,
}: {
  empty?: boolean;
  chartActive?: number;
  staleOpen?: boolean;
  needsSignIn?: boolean;
  readFailed?: boolean;
}) {
  return (
    <AccountsView
      accounts={
        empty ? [] : needsSignIn ? ACCOUNTS_SIGN_IN : readFailed ? ACCOUNTS_NO_BALANCES : ACCOUNTS
      }
      netWorth={empty || readFailed ? [] : NET_WORTH}
      failed={readFailed ? ['balances'] : []}
      today={ACCOUNTS_TODAY}
      needsSignIn={needsSignIn ? NEEDS_SIGN_IN : []}
      chartActive={chartActive}
      staleOpenFor={staleOpen ? STALE_ACCOUNT_ID : undefined}
    />
  );
}

/** One account's page from fixtures: a card, a loan read from Goals, or the brokerage. */
export function FinancesAccountSurface({ kind }: { kind: 'card' | 'loan' | 'brokerage' }) {
  const accountId = ACCOUNT_IDS[kind];
  const row = FIXTURE_ACCOUNTS.find((a) => a.id === accountId)!;
  const [account] = summarize([row], FIXTURE_READINGS, FIXTURE_HOLDINGS, ACCOUNTS_TODAY);
  return (
    <AccountView
      account={account}
      readings={FIXTURE_READINGS.filter((r) => r.accountId === accountId)}
      holdings={FIXTURE_HOLDINGS.filter((h) => h.accountId === accountId)}
      transactions={kind === 'card' ? CARD_TRANSACTIONS : kind === 'loan' ? LOAN_TRANSACTIONS : []}
      moreTransactions={kind === 'card'}
      thread={ACCOUNT_THREAD}
      today={ACCOUNTS_TODAY}
    />
  );
}
