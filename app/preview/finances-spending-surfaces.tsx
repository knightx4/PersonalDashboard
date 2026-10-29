'use client';

import { RouteError } from '@/components/ui/route-error';
import { TransactionsSpendingView, type SpendingTab } from '@/app/finances/spending/transactions-view';
import { SpendingSkeleton } from '@/app/finances/spending/spending-skeleton';
import { SPENDING_EMPTY_PERIOD, SPENDING_THIS_MONTH } from './finances-spending-fixtures';
import { SetTab } from './set-tab';

/**
 * Spending from bank and card transactions (plan #2593.7), one surface per
 * tab and per hidden part: a month held in the chart, a month with nothing
 * posted, a merchant's charges open, a period with no charges, loading and
 * the error.
 */

function Spending({
  tab,
  heldMonth,
  openMerchant,
  empty = false,
}: {
  tab: SpendingTab;
  heldMonth?: string;
  openMerchant?: string;
  empty?: boolean;
}) {
  return (
    <>
      {tab !== 'months' && <SetTab tab={tab} />}
      <TransactionsSpendingView
        range={empty ? 'last_month' : 'this_month'}
        tab={tab}
        data={empty ? SPENDING_EMPTY_PERIOD : SPENDING_THIS_MONTH}
        heldMonth={heldMonth}
        openMerchant={openMerchant}
      />
    </>
  );
}

export const FinancesSpendingSurface = () => <Spending tab="months" />;
export const FinancesSpendingMonthHeldSurface = () => <Spending tab="months" heldMonth="2026-09" />;
export const FinancesSpendingMonthEmptySurface = () => <Spending tab="months" heldMonth="2025-11" />;
export const FinancesSpendingCategoriesSurface = () => <Spending tab="categories" />;
export const FinancesSpendingMerchantsSurface = () => <Spending tab="merchants" />;
export const FinancesSpendingMerchantOpenSurface = () => (
  <Spending tab="merchants" openMerchant="blue bottle coffee" />
);
export const FinancesSpendingChargesSurface = () => <Spending tab="charges" />;
export const FinancesSpendingNoChargesSurface = () => <Spending tab="categories" empty />;
export const FinancesSpendingLoadingSurface = () => <SpendingSkeleton />;

export function FinancesSpendingErrorSurface() {
  return (
    <RouteError
      what="your finances"
      error={Object.assign(new Error('Could not read transactions'), { digest: 'preview' })}
      reset={() => {}}
      backHref="/finances/spending"
      backLabel="Back to spending"
    />
  );
}
