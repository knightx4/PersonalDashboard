import Link from 'next/link';
import { formatMoney, type CurrencyCode, type MerchantSpendSlice } from '@/lib/money';
import { Card, CardBody, CardHeader, CardTitle } from '@/components/ui/card';
import { Meter } from '@/components/ui/meter';
import { Sparkline } from '@/components/ui/sparkline';

export function MerchantBreakdown({
  slices,
  currency,
  trend,
}: {
  slices: MerchantSpendSlice[];
  currency: CurrencyCode;
  /** Twelve months of gross spend per merchant, oldest first. */
  trend?: Map<string, number[]>;
}) {
  const top = slices.slice(0, 8);
  const max = top[0]?.cents ?? 0;

  return (
    <Card className="h-full">
      <CardHeader>
        <CardTitle>By merchant</CardTitle>
      </CardHeader>
      <CardBody className="pt-0">
        {top.length === 0 ? (
          <p className="text-ui text-ink-muted">No orders in this period.</p>
        ) : (
          <ul className="space-y-3">
            {top.map((slice) => {
              const series = trend?.get(slice.merchantId ?? '__unknown__');
              return (
                <li key={slice.merchantId ?? slice.name}>
                  <div className="mb-1 flex items-baseline justify-between gap-3 text-ui">
                    <span className="truncate font-medium text-ink">{slice.name}</span>
                    {/* The bar says how much of this period. The sparkline says
                        whether this is new -- which the row had no room for and
                        is the more useful of the two questions. */}
                    {series && (
                      <span className="ml-auto mr-1 shrink-0 self-center opacity-90">
                        <Sparkline
                          values={series}
                          label={`${slice.name}: twelve-month spending trend`}
                        />
                      </span>
                    )}
                    <span className="tabular shrink-0 text-ink">
                      {formatMoney(slice.cents, currency)}
                    </span>
                  </div>
                  <Meter
                    value={slice.cents}
                    max={max}
                    label={`${slice.name}: ${formatMoney(slice.cents, currency)} of ${formatMoney(max, currency)}, the most spent at one merchant`}
                  />
                </li>
              );
            })}
          </ul>
        )}
        {slices.length > 0 && (
          <p className="mt-4 text-small text-ink-muted">
            Gross orders placed in this period.{' '}
            <Link href="/shopping/orders" className="text-accent hover:underline">
              See all orders
            </Link>
          </p>
        )}
      </CardBody>
    </Card>
  );
}
