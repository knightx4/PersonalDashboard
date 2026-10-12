'use client';

import { useState } from 'react';
import { Card } from '@/components/ui/card';
import { cn } from '@/lib/cn';
import { burnUp, burnUpLabel } from '@/lib/goals/burn-up';
import { formatDay } from '@/lib/goals/dates';
import type { ScopeDay } from '@/lib/goals/scope-days';

const CHART = { width: 600, height: 160 };

/**
 * A goal's or feature's steps across the days (plan #1837): the total with
 * the done count under it, so the gap is what is left and a rising total
 * shows as scope added rather than as progress lost. One scale from zero.
 * The lines keep a fixed stroke while the SVG stretches to the card; the end
 * points are HTML on top, where stretching cannot squash them. Pointing
 * anywhere picks the nearest day and names it underneath. The legend carries
 * the current numbers, so colour is never the only way to tell the lines
 * apart. Nothing is drawn under three days.
 */
export function BurnUpChart({
  days,
  className,
}: {
  /** Oldest first, as loadScopeDays returns them. */
  days: readonly ScopeDay[];
  className?: string;
}) {
  const chart = burnUp(days, CHART);
  const [active, setActive] = useState<number | null>(null);
  if (!chart) return null;

  const last = chart.points.length - 1;
  const shown = chart.points[active ?? last];
  const pct = (value: number, of: number) => `${(value / of) * 100}%`;
  const now = chart.points[last];

  const pick = (event: React.PointerEvent<HTMLDivElement>) => {
    const box = event.currentTarget.getBoundingClientRect();
    const x = ((event.clientX - box.left) / box.width) * chart.width;
    let best = 0;
    chart.points.forEach((point, index) => {
      if (Math.abs(point.x - x) < Math.abs(chart.points[best].x - x)) best = index;
    });
    setActive(best);
  };

  return (
    <Card padding="standard" className={cn('space-y-3', className)}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h2 className="text-ui font-semibold text-ink">Steps over time</h2>
        <p className="tabular flex flex-wrap items-center gap-x-4 gap-y-1 text-small text-ink">
          <span className="inline-flex items-center gap-1.5">
            <span aria-hidden className="h-0.5 w-4 rounded-full bg-accent" />
            Done {now.done}
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span aria-hidden className="h-0.5 w-4 rounded-full bg-ink-muted" />
            Total {now.total}
          </span>
        </p>
      </div>
      <figure className="space-y-1">
        <div className="flex gap-2">
          <div className="tabular flex w-8 shrink-0 flex-col justify-between py-1 text-right text-small text-ink-muted">
            <span>{chart.high}</span>
            <span>0</span>
          </div>
          <div
            className="relative h-40 min-w-0 flex-1"
            onPointerMove={pick}
            onPointerDown={pick}
            onPointerLeave={() => setActive(null)}
          >
            <svg
              viewBox={`0 0 ${chart.width} ${chart.height}`}
              preserveAspectRatio="none"
              className="absolute inset-0 size-full"
              role="img"
              aria-label={burnUpLabel(days)}
            >
              <line
                x1={chart.plot.left}
                x2={chart.plot.right}
                y1={chart.plot.bottom}
                y2={chart.plot.bottom}
                className="stroke-border"
                strokeWidth={1}
                vectorEffect="non-scaling-stroke"
              />
              <path
                d={chart.totalPath}
                fill="none"
                className="stroke-ink-muted"
                strokeWidth={2}
                strokeLinecap="round"
                strokeLinejoin="round"
                vectorEffect="non-scaling-stroke"
              />
              <path
                d={chart.donePath}
                fill="none"
                className="stroke-accent"
                strokeWidth={2}
                strokeLinecap="round"
                strokeLinejoin="round"
                vectorEffect="non-scaling-stroke"
              />
              {active !== null && (
                <line
                  x1={shown.x}
                  x2={shown.x}
                  y1={chart.plot.top}
                  y2={chart.plot.bottom}
                  className="stroke-border-strong"
                  strokeWidth={1}
                  vectorEffect="non-scaling-stroke"
                />
              )}
            </svg>
            {(
              [
                ['done', 'bg-accent', shown.done],
                ['total', 'bg-ink-muted', shown.total],
              ] as const
            ).map(([key, fill, count]) => (
              <span
                key={key}
                aria-hidden
                className={cn(
                  'absolute size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full ring-2 ring-surface',
                  fill,
                )}
                style={{ left: pct(shown.x, chart.width), top: pct(chart.y(count), chart.height) }}
              />
            ))}
          </div>
        </div>
        <figcaption className="tabular pl-10 text-small text-ink">
          {formatDay(shown.day, true)}: {shown.done} of {shown.total} done
        </figcaption>
      </figure>
    </Card>
  );
}
