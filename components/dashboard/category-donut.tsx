'use client';

import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from 'recharts';
import { formatMoney, type CategorySpendSlice, type CurrencyCode } from '@/lib/money';
import { Card, CardBody, CardHeader, CardTitle } from '@/components/ui/card';

export function CategoryDonut({
  slices,
  currency,
}: {
  slices: CategorySpendSlice[];
  currency: CurrencyCode;
}) {
  const total = slices.reduce((sum, slice) => sum + slice.cents, 0);

  return (
    <Card className="h-full">
      <CardHeader>
        <CardTitle>Where it went</CardTitle>
      </CardHeader>
      <CardBody className="pt-0">
        {slices.length === 0 || total === 0 ? (
          <p className="text-ui text-ink-muted">No categorized spend in this period.</p>
        ) : (
          <div className="flex flex-col gap-5 sm:flex-row sm:items-center">
            <div className="mx-auto h-44 w-44 shrink-0">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={slices}
                    dataKey="cents"
                    nameKey="name"
                    innerRadius={48}
                    outerRadius={72}
                    paddingAngle={2}
                    strokeWidth={0}
                  >
                    {slices.map((slice) => (
                      <Cell
                        key={slice.categoryId ?? slice.name}
                        fill={slice.color}
                      />
                    ))}
                  </Pie>
                  <Tooltip
                    formatter={(value) =>
                      formatMoney(typeof value === 'number' ? value : Number(value), currency)
                    }
                    contentStyle={{
                      borderRadius: '0.75rem',
                      borderColor: 'var(--color-border)',
                      fontSize: 12,
                    }}
                  />
                </PieChart>
              </ResponsiveContainer>
            </div>

            <ul className="min-w-0 flex-1 space-y-2">
              {slices.map((slice) => {
                const pct = total === 0 ? 0 : Math.round((slice.cents / total) * 100);
                return (
                  <li
                    key={slice.categoryId ?? slice.name}
                    className="flex items-center gap-2 text-ui"
                  >
                    <span
                      className="size-2.5 shrink-0 rounded-full"
                      style={{ backgroundColor: slice.color }}
                      aria-hidden
                    />
                    <span className="min-w-0 flex-1 truncate text-ink">{slice.name}</span>
                    <span className="tabular text-ink-muted">{pct}%</span>
                    <span className="tabular shrink-0 font-medium text-ink">
                      {formatMoney(slice.cents, currency)}
                    </span>
                  </li>
                );
              })}
            </ul>
          </div>
        )}
      </CardBody>
    </Card>
  );
}
