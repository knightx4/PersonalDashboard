import { Card, CardBody, CardHeader, CardTitle } from '@/components/ui/card';
import { CountUpMoney } from '@/components/dashboard/count-up-money';
import type { CurrencyCode } from '@/lib/money';

/**
 * Stock metric: what the stuff you still own cost. Deliberately not supposed
 * to tie out against period spend — label keeps that clear.
 */
export function ValueOwnedCard({
  cents,
  currency,
}: {
  cents: number;
  currency: CurrencyCode;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Value owned</CardTitle>
      </CardHeader>
      <CardBody className="pt-0">
        <p className="font-display text-3xl font-semibold tracking-tight text-ink tabular">
          <CountUpMoney cents={cents} currency={currency} />
        </p>
        <p className="mt-2 text-ui text-ink-muted">
          Landed cost of items you still own — a stock figure, not what you
          spent this period.
        </p>
      </CardBody>
    </Card>
  );
}
