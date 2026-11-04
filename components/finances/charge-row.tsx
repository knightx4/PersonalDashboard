import Link from '@/components/ui/link';
import { formatDay } from '@/lib/goals/dates';
import { formatMoney } from '@/lib/money';
import type { Charge } from '@/lib/finances/spending/model';

/**
 * One charge from a bank or card account (plan #2593.7): when, who, from
 * which account and under which category, and the amount. A refund reads as
 * money back. A charge tied to a Shopping order links to it, so the order
 * opens from the charge.
 */
export function ChargeRow({
  charge,
  currency = 'USD',
  showName = true,
  withYear = false,
}: {
  charge: Charge;
  currency?: string;
  /** Off inside a merchant's own list, where the name is the heading. */
  showName?: boolean;
  withYear?: boolean;
}) {
  const refund = charge.cents < 0;
  const meta = `${charge.accountName} · ${charge.categoryLabel}`;
  return (
    <li className="flex items-start gap-3 px-4 py-3">
      <span className="tabular w-14 shrink-0 pt-px text-ui text-ink-muted">
        {formatDay(charge.postedOn, withYear)}
      </span>
      <div className="min-w-0 flex-1">
        {showName && <p className="truncate text-body font-medium text-ink">{charge.name}</p>}
        <p className="truncate text-ui text-ink-muted">{meta}</p>
        {charge.orderId && (
          <Link href={`/shopping/orders/${charge.orderId}`} className="text-ui">
            Open the order
          </Link>
        )}
      </div>
      <span className={refund ? 'tabular shrink-0 text-body text-positive' : 'tabular shrink-0 text-body text-ink'}>
        {refund ? `${formatMoney(-charge.cents, currency)} back` : formatMoney(charge.cents, currency)}
      </span>
    </li>
  );
}
