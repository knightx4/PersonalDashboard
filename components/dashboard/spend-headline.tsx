import {
  formatPercentChange,
  formatReconciliation,
  labelForPreset,
  percentChange,
  type CurrencyCode,
  type PresetRange,
  type SpendBreakdown,
} from '@/lib/money';
import { Card, CardBody, CardHeader, CardTitle } from '@/components/ui/card';
import { CountUpMoney } from '@/components/dashboard/count-up-money';

export function SpendHeadline({
  current,
  previous,
  range,
  currency,
}: {
  current: SpendBreakdown;
  previous: SpendBreakdown;
  range: PresetRange;
  currency: CurrencyCode;
}) {
  const change = percentChange(current.netCents, previous.netCents);
  const changeLabel = formatPercentChange(change);
  const rising = change !== null && change > 0;
  const falling = change !== null && change < 0;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Spent · {labelForPreset(range).toLowerCase()}</CardTitle>
      </CardHeader>
      <CardBody className="pt-0">
        <p className="font-display text-4xl font-normal tracking-tight text-ink tabular sm:text-5xl">
          <CountUpMoney cents={current.netCents} currency={currency} />
        </p>
        <p className="mt-2 text-ui text-ink-muted">
          {formatReconciliation(current, currency)}
        </p>
        <p className="mt-3 text-ui text-ink-muted">
          {changeLabel === null ? (
            <>No prior period to compare</>
          ) : (
            <>
              <span
                className={
                  falling
                    ? 'font-medium text-positive'
                    : rising
                      ? 'font-medium text-ink'
                      : 'font-medium text-ink-muted'
                }
              >
                {changeLabel}
              </span>
              {' vs prior period'}
            </>
          )}
        </p>
      </CardBody>
    </Card>
  );
}
