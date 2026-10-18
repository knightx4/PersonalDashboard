'use client';

import { useRef, useState } from 'react';
import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { Tooltip } from '@/components/ui/tooltip';
import { cn } from '@/lib/cn';
import {
  axisLabel,
  barLine,
  currentLabel,
  metricChart,
  metricSummary,
  nothingCounted,
  targetLine,
} from '@/lib/goals/metric-chart';
import type { MetricPeriod, MetricSource, PeriodCount } from '@/lib/goals/metrics';
import { formatNumber } from '@/lib/money';

/** One metric as the Overview draws it: the store's counts and what it reads. */
export type MetricView = {
  id: string;
  name: string;
  period: MetricPeriod;
  target: number | null;
  counts: PeriodCount[];
  /** What it counts (plan #2397.1); a view without one counts a list. */
  source?: MetricSource;
  /** The list it counts, or null when that list is gone. */
  list: string | null;
  /** The label of the date field it counts by, or null. */
  field: string | null;
};

/**
 * A goal's metrics on its Overview (plan #2084.2), one card each, under the
 * goal's number and above the burn-up chart. `null` is a failed read, which
 * shows this section's own message and leaves the rest of the Overview; a
 * goal with no metrics draws nothing.
 */
export function GoalMetrics({
  metrics,
  held,
}: {
  metrics: readonly MetricView[] | null;
  /** For the gallery: hold the tooltip open on this bar of the first chart. */
  held?: number;
}) {
  if (metrics === null) {
    return (
      <Card padding="standard" className="space-y-1">
        <h2 className="text-ui font-semibold text-ink">Metrics</h2>
        <p role="alert" className="text-small text-ink-muted">
          Your metrics could not be read just now. Reload the page to try again.
        </p>
      </Card>
    );
  }
  if (metrics.length === 0) return null;
  return (
    <section aria-label="Metrics" className="space-y-4">
      {metrics.map((metric, index) => (
        <MetricChartCard key={metric.id} metric={metric} held={index === 0 ? held : undefined} />
      ))}
    </section>
  );
}

/** What an empty metric reads: "Counts Job applications by Applied on, each week." */
function readsLine(metric: MetricView): string {
  if (metric.source === 'steps') return `Counts the steps closed on this goal, each ${metric.period}.`;
  if (metric.source === 'files') return `Counts the files Dash writes under this goal, each ${metric.period}.`;
  const list = metric.list ?? 'its list';
  const by = metric.field ? ` by ${metric.field}` : '';
  return `Counts ${list}${by}, each ${metric.period}.`;
}

/**
 * One metric's counts as bars, one per week or month, on one scale from zero.
 * The latest period, which holds today, is drawn in full accent with its
 * count above it; the earlier ones are lighter. The target, when there is
 * one, is a dashed line across with its label. A period with nothing is a
 * hollow stub on the baseline, so a zero reads as zero. Hovering or focusing
 * a bar names its period and count; the arrow keys move along the bars, so
 * the chart is one stop in the tab order. A table holds the same counts for
 * a screen reader.
 */
function MetricChartCard({ metric, held }: { metric: MetricView; held?: number }) {
  const chart = metricChart(metric.counts, metric.period, metric.target);
  const empty = !chart || nothingCounted(metric.counts);
  const count = chart?.bars.length ?? 0;
  const [focus, setFocus] = useState(Math.max(0, count - 1));
  const bars = useRef<(HTMLSpanElement | null)[]>([]);
  // The bar pointed at or focused, which stays in full accent while the rest
  // fade, so the tooltip's bar is plain to see.
  const [picked, setPicked] = useState<number | null>(held ?? null);

  const headingId = `metric-${metric.id}`;
  const heading = (
    <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
      <h2 id={headingId} className="text-ui font-semibold text-ink">
        {metric.name}
      </h2>
      {!empty && chart && (
        <p className="tabular flex flex-wrap items-center gap-x-4 gap-y-1 text-small text-ink">
          <span>{metricSummary(chart, metric.period)}</span>
          {metric.target !== null && (
            <span className="inline-flex items-center gap-1.5 text-ink-muted">
              <span aria-hidden className="w-4 border-t border-dashed border-ink-muted" />
              {targetLine(metric.target, metric.period)}
            </span>
          )}
        </p>
      )}
    </div>
  );

  if (empty || !chart) {
    return (
      <Card padding="standard" className="space-y-3">
        {heading}
        <EmptyState size="inline" title="Nothing counted yet">
          <span className="text-small">{readsLine(metric)}</span>
        </EmptyState>
      </Card>
    );
  }

  const move = (event: React.KeyboardEvent) => {
    const by = { ArrowLeft: -1, ArrowRight: 1, Home: -count, End: count }[event.key];
    if (!by) return;
    event.preventDefault();
    const next = Math.min(count - 1, Math.max(0, focus + by));
    setFocus(next);
    bars.current[next]?.focus();
  };

  const last = count - 1;
  const pct = (share: number) => `${share * 100}%`;

  return (
    <Card padding="standard" className="space-y-3">
      {heading}
      <figure className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-2 gap-y-1">
        <div
          aria-hidden
          className="tabular flex min-w-8 flex-col justify-between pt-5 text-right text-small text-ink-muted"
        >
          <span className="-translate-y-1/2">{formatNumber(chart.high)}</span>
          <span className="translate-y-1/2">0</span>
        </div>
        {/* The bars sit under a 20px band that holds the latest count, so the
            label never meets the card's heading. */}
        <div className="relative h-44 min-w-0 pt-5">
          <div className="relative h-full">
            <div aria-hidden className="absolute inset-x-0 bottom-0 border-t border-border-strong" />
            {/* The target's line; the legend beside the summary names it. */}
            {chart.targetShare !== null && (
              <div
                aria-hidden
                className="pointer-events-none absolute inset-x-0 z-over-link border-t border-dashed border-ink-muted"
                style={{ bottom: pct(chart.targetShare) }}
              />
            )}
            <div
              role="group"
              aria-label={`${metric.name}, by ${metric.period}`}
              className="absolute inset-0 flex items-end gap-[2px]"
              onKeyDown={move}
            >
              {chart.bars.map((bar, index) => {
                const latest = index === last;
                return (
                  <Tooltip
                    key={bar.startsOn}
                    label={barLine(bar)}
                    align={index > count / 2 ? 'end' : 'start'}
                    defaultOpen={held === index}
                    className="h-full min-w-0 flex-1"
                  >
                    <span
                      ref={(node) => {
                        bars.current[index] = node;
                      }}
                      data-metric-bar
                      tabIndex={index === focus ? 0 : -1}
                      aria-label={barLine(bar)}
                      onFocus={() => {
                        setFocus(index);
                        setPicked(index);
                      }}
                      onBlur={() => setPicked(null)}
                      onPointerEnter={(event) => {
                        if (event.pointerType === 'mouse') setPicked(index);
                      }}
                      onPointerLeave={(event) => {
                        if (event.pointerType === 'mouse') setPicked(null);
                      }}
                      className="relative flex h-full w-full items-end justify-center rounded-t-control outline-none focus-visible:ring-2 focus-visible:ring-accent"
                    >
                      {latest && (
                        <span
                          aria-hidden
                          className="tabular absolute inset-x-0 text-center text-small font-semibold text-ink"
                          style={{ bottom: `calc(${pct(bar.share)} + 2px)` }}
                        >
                          {formatNumber(bar.count)}
                        </span>
                      )}
                      {bar.count === 0 ? (
                        <span className="h-1 w-full max-w-12 rounded-t-control border border-b-0 border-border-strong" /* ui-ok: a zero period's hollow stub on the baseline, a chart mark that groups nothing */ />
                      ) : (
                        <span
                          className={cn(
                            'w-full max-w-12 rounded-t-control transition-colors duration-quick',
                            picked === null
                              ? latest
                                ? 'bg-accent'
                                : 'bg-accent/45'
                              : picked === index
                                ? 'bg-accent'
                                : 'bg-accent/25',
                          )}
                          style={{ height: `max(2px, ${pct(bar.share)})` }}
                        />
                      )}
                    </span>
                  </Tooltip>
                );
              })}
            </div>
          </div>
        </div>
        <div aria-hidden className="tabular col-start-2 flex justify-between gap-2 text-small text-ink-muted">
          {count > 1 && <span>{axisLabel(metric.period, chart.bars[0].startsOn)}</span>}
          <span className="ml-auto font-medium text-ink">{currentLabel(metric.period)}</span>
        </div>
        {/* A table ignores the 1px width sr-only gives it, so the box that
            hides it is a div. */}
        <div className="sr-only">
        <table>
          <caption>{`${metric.name}: ${metricSummary(chart, metric.period)}`}</caption>
          <thead>
            <tr>
              <th scope="col">{metric.period === 'week' ? 'Week' : 'Month'}</th>
              <th scope="col">Count</th>
            </tr>
          </thead>
          <tbody>
            {chart.bars.map((bar) => (
              <tr key={bar.startsOn}>
                <th scope="row">{bar.label}</th>
                <td>{bar.count}</td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
      </figure>
    </Card>
  );
}
