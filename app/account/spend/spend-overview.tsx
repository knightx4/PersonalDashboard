import { cardVariants } from '@/components/ui/card';
import { DayBarChart } from '@/components/ui/day-bar-chart';
import { formatMicroDollars } from '@/lib/money';
import type { SpendTotal } from '@/lib/core/spend/summary';
import type { DayValue } from '@/lib/usage/day-bars';

/**
 * The top of the Spend page (plan #2036.3): a chart of what the models cost on
 * each of the last 30 days, then the totals. The "Last 30 days" figure is the
 * sum of the bars' own days, so the two agree.
 */

function Total({ label, total }: { label: string; total: SpendTotal }) {
  return (
    <div className={cardVariants({ padding: 'dense' })}>
      <p className="text-ui text-ink-muted">{label}</p>
      <p className="mt-1 text-heading text-ink tabular-nums">
        {total.calls === 0 ? '—' : formatMicroDollars(total.micros)}
      </p>
      <p className="mt-0.5 text-small text-ink-muted">
        {total.calls === 0
          ? 'nothing yet'
          : `${total.calls} ${total.calls === 1 ? 'call' : 'calls'}${
              total.unpriced > 0
                ? ` · ${total.unpriced} not priced, so the total is short by them`
                : ''
            }`}
      </p>
    </div>
  );
}

export function SpendOverview({
  values,
  today,
  span,
  last30,
  thisMonth,
  allTime,
}: {
  values: readonly DayValue[];
  today: string;
  span: number;
  last30: SpendTotal;
  thisMonth: SpendTotal;
  allTime: SpendTotal;
}) {
  return (
    <>
      <DayBarChart title="Model spend" values={values} end={today} span={span} measure={{ kind: 'spend' }} />
      <div className="mt-3 grid gap-3 sm:grid-cols-3">
        <Total label={`Last ${span} days`} total={last30} />
        <Total label="This month" total={thisMonth} />
        <Total label="All time" total={allTime} />
      </div>
    </>
  );
}
