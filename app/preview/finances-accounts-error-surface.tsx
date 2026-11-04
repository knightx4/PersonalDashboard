'use client';

import { RouteError } from '@/components/ui/route-error';

const failure = Object.assign(new Error('Reading balances failed'), { digest: '3390125784' });

/** The Accounts page when a read failed (plan #2593.6): Finances' own error page. */
export function FinancesAccountsErrorSurface() {
  return (
    <RouteError
      what="your accounts"
      error={failure}
      reset={() => {}}
      backHref="/finances/accounts"
      backLabel="Back to accounts"
    />
  );
}
