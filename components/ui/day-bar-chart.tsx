'use client';

import { useState } from 'react';
import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { cn } from '@/lib/cn';
import { formatDay, formatWeekday } from '@/lib/goals/dates';
import {
  dayBars,
  dayBarsLabel,
  emptyLine,
  formatDayValue,
  formatScale,
  periodPhrase,
  type DayMeasure,
  type DayValue,
} from '@/lib/usage/day-bars';

/**
 * A count or an amount for each day of a period (plan #2036.1), for the
 * usage pages. One bar per day on one scale from zero, so a day with nothing
 * is an empty slot rather than a missing one, and the total for the period
 * sits beside the title. Follows the burn-up chart: the baseline is SVG
 * stretched to the card, the bars are HTML on top, where stretching cannot
 * squash their rounded ends, and pointing at a slot, tapping it or moving
 * along with the arrow keys names its day and value underneath, so the
 * reading never rests on colour or height alone. At rest the line names the
 * busiest day. A period with nothing in it says so in place of the bars.
 */
export function DayBarChart({
  title,
  values,
  end,
  span = 30,
  measure,
  heldDay,
  className,
}: {
  /** What is counted, as the card's heading: "Page views", "Model spend". */
  title: string;
  /** One value per day, in any order; days left out are zero. */
  values: readonly DayValue[];
  /** The last day of the period, YYYY-MM-DD in the person's timezone. */
  end: string;
  /** How many days the period covers, ending on `end`. */
  span?: number;
  measure: DayMeasure;
  /** A day to start with the readout on, as if pointed at. For the gallery. */
  heldDay?: string;
  className?: string;
}) {
  const chart = dayBars(values, end, span);
  const held = heldDay ? chart.bars.findIndex((bar) => bar.day === heldDay) : -1;
  const [active, setActive] = useState<number | null>(held >= 0 ? held : null);

  const count = chart.bars.length;
  const first = chart.bars[0];
  const last = chart.bars[count - 1];
  const shown = active === null ? null : chart.bars[active];

  const pick = (event: React.PointerEvent<HTMLDivElement>) => {
    const box = event.currentTarget.getBoundingClientRect();
    const at = Math.floor(((event.clientX - box.left) / box.width) * count);
    setActive(Math.min(count - 1, Math.max(0, at)));
  };

  const step = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const by = { ArrowLeft: -1, ArrowRight: 1 }[event.key];
    if (event.key === 'Escape') setActive(null);
    if (!by) return;
    event.preventDefault();
    const from = active ?? (by > 0 ? -1 : count);
    setActive(Math.min(count - 1, Math.max(0, from + by)));
  };

  const readout = shown
    ? `${formatWeekday(shown.day)}: ${formatDayValue(shown.value, measure)}`
    : chart.busiest
      ? `Busiest ${formatWeekday(chart.busiest.day)}: ${formatDayValue(chart.busiest.value, measure)}`
      : '';

  return (
    <Card padding="standard" className={cn('space-y-3', className)}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h2 className="text-ui font-semibold text-ink">{title}</h2>
        {chart.busiest && (
          <p className="tabular text-small text-ink">
            {formatScale(chart.total, measure)} {periodPhrase(count)}
          </p>
        )}
      </div>
      {chart.busiest ? (
        <figure className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-2 gap-y-1">
          <div className="tabular flex min-w-6 flex-col justify-between text-right text-small text-ink-muted">
            <span className="-translate-y-1/2">{formatScale(chart.high, measure)}</span>
            <span className="translate-y-1/2">0</span>
          </div>
          <div
            data-day-bars
            tabIndex={0}
            role="img"
            aria-label={dayBarsLabel(title, chart, measure)}
            className="relative h-40 min-w-0 flex-1 cursor-crosshair touch-pan-y rounded-control outline-none focus-visible:ring-2 focus-visible:ring-accent"
            onPointerMove={pick}
            onPointerDown={pick}
            onPointerLeave={(event) => {
              if (event.pointerType === 'mouse') setActive(null);
            }}
            onKeyDown={step}
            onBlur={() => setActive(null)}
          >
            <svg
              viewBox="0 0 100 100"
              preserveAspectRatio="none"
              className="absolute inset-0 size-full overflow-visible"
              aria-hidden
            >
              <line
                x1={0}
                x2={100}
                y1={0}
                y2={0}
                className="stroke-border"
                strokeWidth={1}
                strokeDasharray="2 3"
                vectorEffect="non-scaling-stroke"
              />
              <line
                x1={0}
                x2={100}
                y1={100}
                y2={100}
                className="stroke-border-strong"
                strokeWidth={1}
                vectorEffect="non-scaling-stroke"
              />
            </svg>
            <div aria-hidden className="absolute inset-0 flex items-end gap-[2px]">
              {chart.bars.map((bar, index) => (
                <div
                  key={bar.day}
                  className={cn(
                    'flex h-full min-w-0 flex-1 items-end justify-center rounded-t-control',
                    index === active && 'bg-accent-tint',
                  )}
                >
                  {bar.value > 0 && (
                    <div
                      className={cn(
                        'w-full max-w-12 rounded-t-control bg-accent transition-opacity duration-quick',
                        active !== null && index !== active && 'opacity-45',
                      )}
                      style={{ height: `max(2px, ${bar.share * 100}%)` }}
                    />
                  )}
                </div>
              ))}
            </div>
          </div>
          <div className="tabular col-start-2 flex justify-between gap-2 text-small text-ink-muted">
            <span>{formatDay(first.day)}</span>
            {count > 1 && <span>{formatDay(last.day)}</span>}
          </div>
          <figcaption aria-live="polite" className="tabular col-start-2 text-small text-ink">
            {readout}
          </figcaption>
        </figure>
      ) : (
        <EmptyState size="inline" title={emptyLine(count)} />
      )}
    </Card>
  );
}
