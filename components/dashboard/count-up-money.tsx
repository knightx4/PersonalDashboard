'use client';

import { useCountUp } from '@/components/ui/motion';
import { formatMoney, type CurrencyCode } from '@/lib/money';

/**
 * Count-up for dashboard headline figures. Skips animation when the user has
 * asked for reduced motion, and always lands on the exact final cents value.
 * The count itself is useCountUp in components/ui/motion.ts, which the goal
 * progress count shares.
 */
export function CountUpMoney({
  cents,
  currency = 'USD',
  className,
  durationMs = 700,
}: {
  cents: number;
  currency?: CurrencyCode;
  className?: string;
  durationMs?: number;
}) {
  const display = useCountUp(cents, { durationMs, from: 'zero' });

  return (
    <span className={className} suppressHydrationWarning>
      {formatMoney(display, currency)}
    </span>
  );
}
