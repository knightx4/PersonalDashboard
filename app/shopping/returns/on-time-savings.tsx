'use client';

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { countAt, useReducedMotion } from '@/components/ui/motion';
import { formatMoney } from '@/lib/money';
import { MOTION_MS } from '@/lib/motion';
import type { OnTimeSavings } from '@/lib/returns/savings';

/**
 * Saved by returning on time this year, and the moment a refund adds to it
 * (plan #1563; docs/UI-QUALITY-SPEC.md, Part 8). The first time the figure is
 * in view after a refund that beat its window, it starts at the total before
 * that refund and counts up to the new one, landing on the exact cents.
 * Later visits show the total at once.
 *
 * Which refunds could count up comes from the server: those recorded in the
 * last two weeks (lib/returns/savings.ts). Which of those you have seen is
 * kept in this browser under one key, as Goals keeps the steps Dash finished
 * (app/goals/[goalId]/dash-arrival.ts). Where storage cannot be read nothing
 * counts, since every visit would look like the first. Under reduced motion
 * the refunds are marked seen and the figure shows its new total.
 */

export const COUNTED_KEY = 'shopping.refunds-counted';

/** The most refund ids kept; the oldest go first. */
const KEEP = 400;

/** The ids already counted, or null when storage cannot be read. */
export function readCounted(): string[] | null {
  try {
    const raw = window.localStorage.getItem(COUNTED_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === 'string') : [];
  } catch {
    return null;
  }
}

/** Record that these refunds have been counted into the figure. */
export function rememberCounted(ids: string[]): void {
  try {
    const seen = (readCounted() ?? []).filter((other) => !ids.includes(other));
    seen.push(...ids);
    window.localStorage.setItem(COUNTED_KEY, JSON.stringify(seen.slice(-KEEP)));
  } catch {
    /* Storage blocked: readCounted returns null, so nothing counts again either. */
  }
}

/** useLayoutEffect in the browser, so the start value is set before paint. */
const useBeforePaint = typeof window === 'undefined' ? useEffect : useLayoutEffect;

function SavingsFigure({ savings }: { savings: OnTimeSavings }) {
  const { totalCents, recent, currency } = savings;
  const reduceMotion = useReducedMotion();
  const ref = useRef<HTMLSpanElement>(null);
  const [shown, setShown] = useState(totalCents);
  const recentKey = recent.map((r) => r.id).join(',');

  useBeforePaint(() => {
    const seen = readCounted();
    const unseen = seen === null ? [] : recent.filter((r) => !seen.includes(r.id));
    if (unseen.length === 0) {
      setShown(totalCents);
      return;
    }
    const ids = unseen.map((r) => r.id);
    if (reduceMotion) {
      rememberCounted(ids);
      setShown(totalCents);
      return;
    }
    const from = totalCents - unseen.reduce((sum, r) => sum + r.cents, 0);
    setShown(from);

    const el = ref.current;
    let frame = 0;
    const count = () => {
      rememberCounted(ids);
      const began = performance.now();
      const tick = (now: number) => {
        setShown(countAt(from, totalCents, now - began, MOTION_MS.moment));
        if (now - began < MOTION_MS.moment) frame = requestAnimationFrame(tick);
      };
      frame = requestAnimationFrame(tick);
    };
    if (!el || typeof IntersectionObserver === 'undefined') {
      count();
      return () => cancelAnimationFrame(frame);
    }
    const observer = new IntersectionObserver((entries) => {
      if (!entries.some((entry) => entry.isIntersecting)) return;
      observer.disconnect();
      count();
    });
    observer.observe(el);
    return () => {
      observer.disconnect();
      cancelAnimationFrame(frame);
      setShown(totalCents);
    };
  }, [totalCents, recentKey, reduceMotion]);

  return (
    <span ref={ref} className="tabular-nums text-title font-semibold text-ink" suppressHydrationWarning>
      {formatMoney(shown, currency)}
    </span>
  );
}

export function OnTimeSavingsFigure({ savings }: { savings: OnTimeSavings[] }) {
  if (savings.length === 0) return null;
  return (
    <div className="mb-4 flex flex-wrap items-baseline gap-x-3 gap-y-1">
      <span className="text-ui text-ink-muted">Saved by returning on time this year</span>
      {savings.map((entry) => (
        <SavingsFigure key={entry.currency} savings={entry} />
      ))}
    </div>
  );
}
