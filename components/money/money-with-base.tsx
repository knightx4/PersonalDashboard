import { formatMoney } from '@/lib/money';
import { cn } from '@/lib/cn';
import { normalizeCurrencyCode } from '@/lib/fx/money-fx';

/**
 * Purchase currency on top; when it differs from the user's display currency,
 * show the converted base amount underneath for reference.
 */
export function MoneyWithBase({
  cents,
  currency,
  displayCents,
  displayCurrency,
  className,
  primaryClassName,
  secondaryClassName,
  align = 'right',
}: {
  cents: number;
  currency: string;
  displayCents?: number;
  displayCurrency?: string;
  className?: string;
  primaryClassName?: string;
  secondaryClassName?: string;
  align?: 'left' | 'right';
}) {
  const showBase =
    displayCents != null &&
    displayCurrency != null &&
    normalizeCurrencyCode(currency) !== normalizeCurrencyCode(displayCurrency);

  return (
    <span
      className={cn(
        'tabular inline-flex flex-col',
        align === 'right' ? 'items-end text-right' : 'items-start text-left',
        className,
      )}
    >
      <span className={primaryClassName}>{formatMoney(cents, currency)}</span>
      {showBase && (
        <span className={cn('mt-0.5 text-[11px] font-normal text-ink-faint', secondaryClassName)}>
          ≈ {formatMoney(displayCents, displayCurrency)}
        </span>
      )}
    </span>
  );
}
