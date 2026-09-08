import Link from 'next/link';
import {
  formatPercentChange,
  formatReconciliation,
  labelForPreset,
  percentChange,
  type CurrencyCode,
  type Period,
  type PresetRange,
  type SpendBreakdown,
} from '@/lib/money';
import { Figure, FigureDelta } from '@/components/ui/figure';
import { CountUpMoney } from '@/components/dashboard/count-up-money';

/** "1 – 7 Sep", or "1 Aug – 7 Sep" when the period crosses a month. */
function formatPeriod(period: Period): string {
  const day = new Intl.DateTimeFormat('en-GB', { day: 'numeric', timeZone: 'UTC' });
  const dayMonth = new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  });
  const start = new Date(`${period.start}T12:00:00Z`);
  const end = new Date(`${period.end}T12:00:00Z`);
  const sameMonth = period.start.slice(0, 7) === period.end.slice(0, 7);
  return `${sameMonth ? day.format(start) : dayMonth.format(start)} – ${dayMonth.format(end)}`;
}

/**
 * The spend figure: the reason the dashboard exists, and so the one thing on
 * it that is not in a card. Everything that used to get a card of its own
 * beside it -- value owned, the order count, what is still returnable -- is
 * the quiet row beneath the rule, where it supports the figure instead of
 * competing with it.
 */
export function SpendHeadline({
  current,
  previous,
  range,
  period,
  currency,
  valueOwnedCents,
  orderCount,
  returnableCount,
}: {
  current: SpendBreakdown;
  previous: SpendBreakdown;
  range: PresetRange;
  period: Period;
  currency: CurrencyCode;
  valueOwnedCents: number;
  orderCount: number;
  returnableCount: number;
}) {
  const change = percentChange(current.netCents, previous.netCents);
  const changeLabel = formatPercentChange(change);
  const direction = change === null ? null : change > 0 ? 'up' : change < 0 ? 'down' : 'flat';

  return (
    <Figure
      label={`Spent · ${labelForPreset(range).toLowerCase()}`}
      meta={formatPeriod(period)}
      value={<CountUpMoney cents={current.netCents} currency={currency} />}
      aside={<FigureDelta label={changeLabel} direction={direction} suffix="vs prior period" />}
      caption={formatReconciliation(current, currency)}
      secondary={[
        {
          value: <CountUpMoney cents={valueOwnedCents} currency={currency} />,
          label: 'value owned, at what it cost',
        },
        { value: orderCount, label: orderCount === 1 ? 'order in the period' : 'orders in the period' },
        {
          value: (
            <Link href="/shopping/returns" className="hover:text-accent">
              {returnableCount}
            </Link>
          ),
          label: returnableCount === 1 ? 'thing still returnable' : 'things still returnable',
        },
      ]}
    />
  );
}
