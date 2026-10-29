import { AccountView } from '@/app/finances/accounts/account-view';
import { AccountsView } from '@/app/finances/accounts/accounts-view';
import { MonthReview } from '@/app/finances/accounts/month-review';
import { MonthReviewSkeleton } from '@/app/finances/accounts/month-review-skeleton';
import { PaidCostsProvider } from '@/components/ui/paid-hint';
import { MODELS } from '@/lib/core/models';
import type { CostEstimate } from '@/lib/core/spend/estimate-types';
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
import {
  REVIEW_ACCOUNTS_LINE,
  REVIEW_FAILED,
  REVIEW_FIRST,
  REVIEW_OPEN_LINE,
  REVIEW_QUIET,
  REVIEW_THREAD,
  REVIEW_TODAY,
  REVIEW_WRITTEN,
} from './finances-review-fixtures';

/** Which state of the monthly review the Accounts page is drawn with (plan #2593.8.3). */
export type ReviewFixture =
  | 'open'
  | 'closed'
  | 'charges'
  | 'account'
  | 'quiet'
  | 'failed'
  | 'retrying'
  | 'first'
  | 'loading';

/** One Sonnet call, as the guess for 'write-money-review' prices it. */
const REVIEW_COST: CostEstimate = {
  lowMicros: 20_000,
  medianMicros: 32_000,
  highMicros: 50_000,
  runs: 0,
  basis: 'guess',
  per: 'run',
  models: [MODELS.moneyReview],
};

function ReviewFor({ state }: { state: ReviewFixture }) {
  switch (state) {
    case 'loading':
      return <MonthReviewSkeleton />;
    case 'first':
      return <MonthReview panel={REVIEW_FIRST} thread={[]} defaultOpen today={REVIEW_TODAY} />;
    case 'quiet':
      return <MonthReview panel={REVIEW_QUIET} thread={[]} defaultOpen today={REVIEW_TODAY} />;
    case 'failed':
    case 'retrying':
      // Priced as the Finances shell prices it (law 16).
      return (
        <PaidCostsProvider
          costs={{ 'app/finances/accounts/actions.ts#tryMonthReviewAgain': REVIEW_COST }}
        >
          <MonthReview
            panel={REVIEW_FAILED}
            thread={[]}
            defaultOpen
            today={REVIEW_TODAY}
            retrying={state === 'retrying'}
          />
        </PaidCostsProvider>
      );
    default:
      return (
        <MonthReview
          panel={REVIEW_WRITTEN}
          thread={REVIEW_THREAD}
          defaultOpen={state !== 'closed'}
          today={REVIEW_TODAY}
          openLine={
            state === 'charges'
              ? REVIEW_OPEN_LINE
              : state === 'account'
                ? REVIEW_ACCOUNTS_LINE
                : undefined
          }
        />
      );
  }
}

/** Finances' Accounts page from fixtures (plan #2593.6), with a hidden part held open when asked. */
export function FinancesAccountsSurface({
  empty = false,
  chartActive,
  staleOpen = false,
  needsSignIn = false,
  readFailed = false,
  review = 'closed',
}: {
  empty?: boolean;
  chartActive?: number;
  staleOpen?: boolean;
  needsSignIn?: boolean;
  readFailed?: boolean;
  /** The monthly review's state; closed unless a review surface asks for another. */
  review?: ReviewFixture;
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
      review={<ReviewFor state={review} />}
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
