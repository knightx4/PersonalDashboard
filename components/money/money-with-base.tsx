import { formatMoney } from '@/lib/money';
import { cn } from '@/lib/cn';
import { normalizeCurrencyCode } from '@/lib/fx/money-fx';

/**
 * Display/base currency on top; when the purchase currency differs,
 * show the foreign amount underneath for reference.
 */
export function MoneyWithBase({
  cents,
  currency,
  foreignCents,
  foreignCurrency,
  className,
  primaryClassName,
  secondaryClassName,
  align = 'right',
}: {
  cents: number;
  currency: string;
  foreignCents?: number;
  foreignCurrency?: string;
  className?: string;
  primaryClassName?: string;
  secondaryClassName?: string;
  align?: 'left' | 'right';
}) {
  const showForeign =
    foreignCents != null &&
    foreignCurrency != null &&
    normalizeCurrencyCode(currency) !== normalizeCurrencyCode(foreignCurrency);

  return (
    <span
      className={cn(
        'tabular inline-flex flex-col',
        align === 'right' ? 'items-end text-right' : 'items-start text-left',
        className,
      )}
    >
      <span className={primaryClassName}>{formatMoney(cents, currency)}</span>
      {showForeign && (
        <span className={cn('mt-0.5 text-[11px] font-normal text-ink-faint', secondaryClassName)}>
          {formatMoney(foreignCents, foreignCurrency)}
        </span>
      )}
    </span>
  );
}
