'use client';

import { useState } from 'react';
import { popoverSurface } from '@/components/ui/popover';
import { cn } from '@/lib/cn';
import { whenDate } from '@/lib/core/when';
import type { NetWorthPoint } from '@/lib/finances/accounts';
import { formatMoney } from '@/lib/money';

const CHART = { width: 600, height: 160 };
const PLOT = { left: 6, right: CHART.width - 6, top: 10, bottom: CHART.height - 10 };
const DAY_MS = 86_400_000;
/** The line's stroke: a chart line, heavier than an icon's. */
const LINE_WIDTH = 2;
const UTC = { timeZone: 'UTC' } as const;

/** Whole dollars on the axis and in the caption: the cents are noise at this size. */
const dollars = (cents: number) => formatMoney(cents, 'USD', { showCents: false });

/**
 * A balance over time (plan #2593.6): net worth on the Accounts page, one
 * account's balance on its own page. One line against a scale fitted to the
 * values, with zero drawn when the line crosses it. The line keeps a fixed
 * stroke while the SVG stretches to its box; the marker is HTML on top, where
 * stretching cannot squash it, as in the burn-up chart. Pointing anywhere
 * picks the nearest day and names its date and value over it; the first
 * and last dates sit under the two ends of the line.
 */
export function BalanceChart({
  points,
  label,
  initialActive = null,
  summary,
  className,
}: {
  /** One quiet line under the chart giving what it shows: "Down $2,716 since 20 Oct 2025". */
  summary?: string;
  /** Oldest first, one a day or fewer. */
  points: readonly NetWorthPoint[];
  /** Read aloud in place of the line. */
  label: string;
  /** A day picked from the start, as an index: the gallery draws the hover held. */
  initialActive?: number | null;
  className?: string;
}) {
  const [active, setActive] = useState<number | null>(initialActive);
  if (points.length < 2) return null;

  const values = points.map((p) => p.cents);
  let high = Math.max(...values);
  let low = Math.min(...values);
  if (high === low) {
    high += 100;
    low -= 100;
  }
  const at = (day: string) => Date.parse(`${day}T00:00:00Z`) / DAY_MS;
  const first = at(points[0].day);
  const span = Math.max(1, at(points[points.length - 1].day) - first);
  const x = (day: string) => PLOT.left + ((at(day) - first) / span) * (PLOT.right - PLOT.left);
  const y = (cents: number) =>
    PLOT.bottom - ((cents - low) / (high - low)) * (PLOT.bottom - PLOT.top);
  const path = `M${points.map((p) => `${x(p.day).toFixed(2)},${y(p.cents).toFixed(2)}`).join('L')}`;
  const crossesZero = low < 0 && high > 0;

  const last = points.length - 1;
  const shown = points[active ?? last];
  const pct = (value: number, of: number) => `${(value / of) * 100}%`;

  const pick = (event: React.PointerEvent<HTMLDivElement>) => {
    const box = event.currentTarget.getBoundingClientRect();
    const px = PLOT.left + ((event.clientX - box.left) / box.width) * (PLOT.right - PLOT.left);
    let best = 0;
    points.forEach((point, index) => {
      if (Math.abs(x(point.day) - px) < Math.abs(x(points[best].day) - px)) best = index;
    });
    setActive(best);
  };

  // The readout hangs over the picked day: from its left edge on the left
  // half of the chart, from its right edge on the right half, so it never
  // runs off the box.
  const shownX = x(shown.day) / CHART.width;

  return (
    <figure className={cn('space-y-1', className)}>
      <div className="flex gap-2">
        <div className="tabular flex w-16 shrink-0 flex-col justify-between pb-6 pt-1 text-right text-small text-ink-muted">
          <span>{dollars(high)}</span>
          <span>{dollars(low)}</span>
        </div>
        <div className="min-w-0 flex-1">
          <div
            className="relative h-36 touch-pan-y"
            onPointerMove={pick}
            onPointerDown={pick}
            onPointerLeave={() => setActive(null)}
          >
            <svg
              viewBox={`0 0 ${CHART.width} ${CHART.height}`}
              preserveAspectRatio="none"
              className="absolute inset-0 size-full"
              role="img"
              aria-label={label}
            >
              <line
                x1={PLOT.left}
                x2={PLOT.right}
                y1={PLOT.bottom}
                y2={PLOT.bottom}
                className="stroke-border"
                strokeWidth={1}
                vectorEffect="non-scaling-stroke"
              />
              {crossesZero && (
                <line
                  x1={PLOT.left}
                  x2={PLOT.right}
                  y1={y(0)}
                  y2={y(0)}
                  className="stroke-border"
                  strokeWidth={1}
                  strokeDasharray="4 4"
                  vectorEffect="non-scaling-stroke"
                />
              )}
              <path
                d={path}
                fill="none"
                className="stroke-accent"
                strokeWidth={LINE_WIDTH}
                strokeLinecap="round"
                strokeLinejoin="round"
                vectorEffect="non-scaling-stroke"
              />
              {active !== null && (
                <line
                  x1={x(shown.day)}
                  x2={x(shown.day)}
                  y1={PLOT.top}
                  y2={PLOT.bottom}
                  className="stroke-border-strong"
                  strokeWidth={1}
                  vectorEffect="non-scaling-stroke"
                />
              )}
            </svg>
            <span
              aria-hidden
              className="absolute size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-accent ring-2 ring-surface"
              style={{
                left: pct(x(shown.day), CHART.width),
                top: pct(y(shown.cents), CHART.height),
              }}
            />
            {active !== null && (
              <span
                className={cn(
                  popoverSurface,
                  'tabular pointer-events-none absolute -top-1 whitespace-nowrap px-2 py-0.5 text-small text-ink',
                  shownX > 0.5 ? '-translate-x-full' : '',
                )}
                style={{ left: pct(x(shown.day), CHART.width) }}
                aria-live="polite"
              >
                {whenDate(shown.day, UTC)}: {dollars(shown.cents)}
              </span>
            )}
          </div>
          <div className="tabular mt-1 flex justify-between text-small text-ink-muted" aria-hidden>
            <span>{whenDate(points[0].day, UTC)}</span>
            <span>{whenDate(points[last].day, UTC)}</span>
          </div>
        </div>
      </div>
      {summary && (
        <figcaption className="pl-[4.5rem] text-small text-ink-muted">{summary}</figcaption>
      )}
    </figure>
  );
}
