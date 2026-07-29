'use client';

import { useEffect, useState, useSyncExternalStore } from 'react';
import { formatMoney, type CurrencyCode } from '@/lib/money';

function subscribeReducedMotion(onStoreChange: () => void): () => void {
  const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
  mq.addEventListener('change', onStoreChange);
  return () => mq.removeEventListener('change', onStoreChange);
}

function getReducedMotionSnapshot(): boolean {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

function getReducedMotionServerSnapshot(): boolean {
  return false;
}

/**
 * Count-up for dashboard headline figures. Skips animation when the user has
 * asked for reduced motion, and always lands on the exact final cents value.
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
  const reduceMotion = useSyncExternalStore(
    subscribeReducedMotion,
    getReducedMotionSnapshot,
    getReducedMotionServerSnapshot,
  );

  const [animated, setAnimated] = useState(0);

  useEffect(() => {
    if (reduceMotion) return;

    let frame = 0;
    const start = performance.now();
    const from = 0;
    const to = cents;

    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / durationMs);
      // ease-out soft, matching --ease-out-soft
      const eased = 1 - Math.pow(1 - t, 3);
      setAnimated(Math.round(from + (to - from) * eased));
      if (t < 1) frame = requestAnimationFrame(tick);
      else setAnimated(to);
    };

    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [cents, durationMs, reduceMotion]);

  const display = reduceMotion ? cents : animated;

  return (
    <span className={className} suppressHydrationWarning>
      {formatMoney(display, currency)}
    </span>
  );
}
