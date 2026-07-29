import Link from 'next/link';
import { formatMoney, type CurrencyCode, type MerchantSpendSlice } from '@/lib/money';
import { Card, CardBody, CardHeader, CardTitle } from '@/components/ui/card';

export function MerchantBreakdown({
  slices,
  currency,
}: {
  slices: MerchantSpendSlice[];
  currency: CurrencyCode;
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
          <p className="text-[13px] text-ink-muted">No orders in this period.</p>
        ) : (
          <ul className="space-y-3">
            {top.map((slice) => {
              const width = max === 0 ? 0 : Math.round((slice.cents / max) * 100);
              return (
                <li key={slice.merchantId ?? slice.name}>
                  <div className="mb-1 flex items-baseline justify-between gap-3 text-[13px]">
                    <span className="truncate font-medium text-ink">{slice.name}</span>
                    <span className="tabular shrink-0 text-ink">
                      {formatMoney(slice.cents, currency)}
                    </span>
                  </div>
                  <div className="h-1.5 overflow-hidden rounded-full bg-canvas">
                    <div
                      className="h-full rounded-full bg-brand"
                      style={{ width: `${width}%` }}
                    />
                  </div>
                </li>
              );
            })}
          </ul>
        )}
        {slices.length > 0 && (
          <p className="mt-4 text-[12px] text-ink-faint">
            Gross orders placed in this period.{' '}
            <Link href="/orders" className="text-brand hover:underline">
              See all orders
            </Link>
          </p>
        )}
      </CardBody>
    </Card>
  );
}
