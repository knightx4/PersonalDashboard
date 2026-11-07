'use client';

import { useEffect, useRef, useState } from 'react';
import { ArrowDown, ArrowUp, Maximize2, X } from 'lucide-react';
import {
  Area,
  AreaChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { Meter } from '@/components/ui/meter';
import { Chip } from '@/components/ui/chip';
import { IconButton } from '@/components/ui/icon-button';
import { cn } from '@/lib/cn';
import { formatNumber } from '@/lib/money';
import { SectionLabel } from '@/components/ui/section-heading';
import { MessageCard } from '@/components/patterns/messaging';
import {
  chartChange,
  chartValue,
  rowValues,
  sortedRows,
  tableHeadings,
  turnCharts,
  type DashChart,
  type TableSort,
} from '@/lib/talk/chart';
import type { TalkToolCall } from '@/lib/talk/talk';

/**
 * The charts Dash drew in an answer (plan #1655), read from the turn's kept
 * tool calls (lib/talk/chart.ts), so a reopened answer draws them as it did.
 * Bars are the merchant breakdown's rows (components/dashboard/
 * merchant-breakdown.tsx): the label and the figure on one line, the meter
 * under them, where the length compares rows and the figure is read.
 *
 * Lines and areas (plan #3050.2.1) are drawn with recharts, as Learn's chart
 * figures are (lib/learn/figures/kinds/chart-plot.tsx), with a tooltip on
 * hover or tap. A table with series sorts by any heading and scrolls
 * sideways on a phone with its labels held at the left. Both open full screen.
 */

function Bars({ chart }: { chart: DashChart }) {
  const max = Math.max(0, ...chart.rows.map((row) => row.value));
  const unit = chart.unit ? ` ${chart.unit}` : '';
  return (
    <ul className="space-y-2.5">
      {chart.rows.map((row, i) => {
        const value = chartValue(chart, row.value);
        return (
          <li key={`${i}-${row.label}`}>
            <div className="mb-1 flex items-baseline justify-between gap-3 text-ui">
              <span className="min-w-0 truncate text-ink" title={row.label}>
                {row.label}
              </span>
              <span className="tabular shrink-0 text-ink">{value}</span>
            </div>
            <Meter
              value={row.value}
              max={max}
              fill="bg-ink-muted"
              track="canvas"
              minFraction={0.02}
              label={`${row.label}: ${value}${unit}`}
            />
          </li>
        );
      })}
    </ul>
  );
}

/** A value as a line, an area or a table prints it: a share of change takes its sign and %. */
function printed(chart: DashChart, value: number): string {
  if (chart.unit !== '%') return chartValue(chart, value);
  return `${value > 0 ? '+' : ''}${chartValue(chart, value)}%`;
}

/**
 * A table drawn by hand rather than with components/ui/table.tsx: that one
 * fades its right edge on a phone to show it scrolls, and a column of figures
 * this narrow never needs to, so the fade only hid the numbers. A table with
 * several series can be wider than a phone: it scrolls sideways inside its
 * own box, with the labels held at the left so each row stays named.
 *
 * Every heading sorts: a press sorts by that column, largest first (A to Z
 * for the labels), and a second press turns it round.
 */
function Rows({ chart }: { chart: DashChart }) {
  const headings = tableHeadings(chart);
  const [sort, setSort] = useState<TableSort | null>(null);
  const rows = sortedRows(chart, sort);
  const wide = headings.length > 2;
  // Whether columns go on past the right edge: a fade there says the table scrolls.
  const scroller = useRef<HTMLDivElement>(null);
  const [more, setMore] = useState(false);
  useEffect(() => {
    const box = scroller.current;
    if (!box || !wide) return;
    const measure = () => setMore(box.scrollWidth - box.clientWidth - box.scrollLeft > 2);
    measure();
    box.addEventListener('scroll', measure, { passive: true });
    window.addEventListener('resize', measure);
    return () => {
      box.removeEventListener('scroll', measure);
      window.removeEventListener('resize', measure);
    };
  }, [wide]);

  const press = (column: number) =>
    setSort((now) =>
      now && now.column === column
        ? { column, descending: !now.descending }
        : { column, descending: column !== 0 },
    );

  return (
    <div className="relative">
      <div ref={scroller} className={cn(wide && '-mx-3 overflow-x-auto px-3')}>
        <table className="w-full border-collapse text-ui">
          <thead>
            <tr>
              {headings.map((heading, column) => {
                const sorted = sort?.column === column;
                const name = heading || 'Row';
                const Arrow = sorted && sort.descending ? ArrowDown : ArrowUp;
                return (
                  <th
                    key={column}
                    scope="col"
                    aria-sort={sorted ? (sort.descending ? 'descending' : 'ascending') : 'none'}
                    className={cn(
                      'pb-1.5 align-bottom font-normal',
                      column === 0 ? 'text-left' : wide ? 'pl-3 text-left' : 'pl-3 text-right',
                      column === 0 && wide && 'sticky left-0 z-over-link min-w-24 bg-sunken pr-2',
                      // With several series a heading wraps over its figures, which start at its left
                      // edge, so a column cut by a phone's edge shows the start of its numbers too.
                      column > 0 && wide && 'w-14 min-w-14',
                    )}
                  >
                    <button
                      type="button"
                      onClick={() => press(column)}
                      className={cn(
                        'press-area inline-flex items-center gap-1 rounded-control hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2',
                        column > 0 && !wide && 'flex-row-reverse text-right',
                        sorted ? 'text-ink' : 'text-ink-muted',
                      )}
                    >
                      {heading ? (
                        <SectionLabel as="span" className={sorted ? 'text-ink' : undefined}>
                          {heading}
                        </SectionLabel>
                      ) : (
                        <span className="sr-only">{name}</span>
                      )}
                      <Arrow
                        strokeWidth={1.75}
                        aria-hidden
                        className={cn('size-3 shrink-0', sorted ? 'opacity-100' : 'opacity-0')}
                      />
                      <span className="sr-only">, sort</span>
                    </button>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {rows.map((row, i) => (
              <tr key={`${i}-${row.label}`}>
                <td
                  className={cn(
                    'py-2 text-ink',
                    wide && 'sticky left-0 z-over-link bg-sunken pr-2',
                  )}
                >
                  {row.label}
                </td>
                {rowValues(row).map((value, column) => (
                  <td
                    key={column}
                    className={cn(
                      'tabular whitespace-nowrap py-2 pl-3 text-ink',
                      wide ? 'text-left' : 'text-right',
                    )}
                  >
                    {printed(chart, value)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {more && (
        <div
          aria-hidden
          className="pointer-events-none absolute inset-y-0 -right-3 w-12 bg-gradient-to-l from-sunken to-transparent"
        />
      )}
    </div>
  );
}

/**
 * How each series is told apart, without leaning on colour alone: the first
 * solid in ink, the second solid in muted ink, the third and fourth dashed
 * and dotted in muted ink. The key above the plot draws the same strokes.
 */
const SERIES_STROKES = [
  { stroke: 'var(--chart-0)', width: 2.25, dash: undefined },
  { stroke: 'var(--chart-1)', width: 2, dash: undefined },
  { stroke: 'var(--chart-1)', width: 1.75, dash: '6 4' },
  { stroke: 'var(--chart-1)', width: 1.75, dash: '1.5 3.5' },
] as const;

/**
 * The plot's colours, read onto its own box as Learn's plots do
 * (chart-plot.tsx). One series wears the accent. Several are told apart by
 * ink and dashes with no accent: the chart has no one series as its subject,
 * so none is singled out (spec R12).
 */
const ONE_SERIES = '[--chart-0:var(--c-accent)]';
const SEVERAL_SERIES = '[--chart-0:var(--c-ink)] [--chart-1:var(--c-ink-muted)]';

const AXIS_TICK = { fill: 'var(--c-ink-muted)', fontSize: 11 };

/** An axis figure, short: 1.2k, 43k, 6.1M. */
function tick(chart: DashChart, value: number): string {
  const size = Math.abs(value);
  const one = { maximumFractionDigits: 1 };
  const short =
    size >= 1e6
      ? `${formatNumber(value / 1e6, one)}M`
      : size >= 1e3
        ? `${formatNumber(value / 1e3, one)}k`
        : formatNumber(value, one);
  if (chart.unit === '%') return `${value > 0 ? '+' : ''}${short}%`;
  return short;
}

/**
 * The key above the plot, which is also its tooltip: the name of each series
 * beside its stroke, and, while a point is hovered or tapped, that point's
 * label and each series' value there. Above the plot rather than over it, so
 * a held point hides none of the lines.
 */
function Key({
  chart,
  series,
  at,
}: {
  chart: DashChart;
  series: readonly string[];
  at: number | null;
}) {
  const row = at === null ? null : (chart.rows[at] ?? null);
  const values = row ? rowValues(row) : null;
  if (series.length < 2 && !row) return null;
  return (
    <div
      className="mb-2 flex min-h-5 flex-wrap items-baseline gap-x-4 gap-y-1 text-small text-ink-muted"
      aria-hidden
    >
      {row && <span className="font-medium text-ink">{row.label}</span>}
      {series.map((name, i) => {
        const look = SERIES_STROKES[i % SERIES_STROKES.length];
        return (
          <span key={name} className="flex items-center gap-1.5">
            <svg width="18" height="6" viewBox="0 0 18 6" className="shrink-0 self-center">
              <line
                x1="1"
                y1="3"
                x2="17"
                y2="3"
                stroke={look.stroke}
                strokeWidth={look.width}
                strokeDasharray={look.dash}
                strokeLinecap="round"
              />
            </svg>
            {series.length > 1 && <span>{name}</span>}
            {values && (
              <span className="tabular font-medium text-ink">{printed(chart, values[i])}</span>
            )}
          </span>
        );
      })}
    </div>
  );
}

/**
 * Lines or areas over the same labels, oldest first, on one scale. Hovering
 * or tapping a point names its label and every series' value there. A screen
 * reader hears the same figures as a table it cannot see.
 */
function Plot({
  chart,
  tall = false,
  tipAt,
}: {
  chart: DashChart;
  tall?: boolean;
  tipAt?: number;
}) {
  const series = chart.series ?? [chart.unit ?? chart.title];
  const data = chart.rows.map((row) => {
    const point: Record<string, string | number> = { label: row.label };
    rowValues(row).forEach((value, i) => (point[`s${i}`] = value));
    return point;
  });
  const values = chart.rows.flatMap(rowValues);
  const below = values.some((value) => value < 0);
  const area = chart.kind === 'area';
  const Chart = area ? AreaChart : LineChart;
  const margin = { top: 6, right: 6, bottom: 0, left: 0 };
  const [at, setAt] = useState<number | null>(tipAt ?? null);
  // Recharts hands the hovered or tapped point's index as a string.
  const follow = (state: { activeTooltipIndex?: unknown } | null) => {
    const index = Number(state?.activeTooltipIndex);
    setAt(state?.activeTooltipIndex == null || !Number.isInteger(index) ? null : index);
  };

  return (
    <div className={series.length > 1 ? SEVERAL_SERIES : ONE_SERIES}>
      <Key chart={chart} series={series} at={at} />
      <div
        aria-hidden
        className={cn(
          'w-full',
          tall ? 'h-[max(16rem,calc(100dvh-12rem))] sm:h-[min(60dvh,32rem)]' : 'h-44 sm:h-52',
        )}
      >
        <ResponsiveContainer width="100%" height="100%">
          <Chart
            data={data}
            margin={margin}
            onMouseMove={follow}
            onClick={follow}
            onMouseLeave={() => setAt(null)}
          >
            <CartesianGrid vertical={false} stroke="var(--c-border)" strokeDasharray="2 4" />
            <XAxis
              dataKey="label"
              tick={AXIS_TICK}
              tickLine={false}
              axisLine={{ stroke: 'var(--c-border)' }}
              minTickGap={16}
              tickMargin={6}
              interval="preserveStartEnd"
            />
            <YAxis
              tick={AXIS_TICK}
              tickLine={false}
              axisLine={false}
              width={44}
              tickFormatter={(value: number) => tick(chart, value)}
              domain={area && !below ? [0, 'auto'] : ['auto', 'auto']}
            />
            {/* The cursor and the points only: the figures show in the key above the plot. */}
            <Tooltip
              defaultIndex={tipAt}
              content={() => null}
              cursor={{ stroke: 'var(--c-border-strong)' }}
            />
            {series.map((name, i) => {
              const look = SERIES_STROKES[i % SERIES_STROKES.length];
              const shared = {
                dataKey: `s${i}`,
                name: `s${i}`,
                // Straight between points: a curve would draw highs and lows the figures never had.
                type: 'linear' as const,
                stroke: look.stroke,
                strokeWidth: look.width,
                strokeDasharray: look.dash,
                dot: false,
                activeDot: {
                  r: 3.5,
                  strokeWidth: 2,
                  stroke: 'var(--c-surface)',
                  fill: look.stroke,
                },
                isAnimationActive: false,
              };
              return area ? (
                <Area
                  key={name}
                  {...shared}
                  fill={look.stroke}
                  fillOpacity={series.length > 1 ? 0.06 : 0.16}
                />
              ) : (
                <Line key={name} {...shared} />
              );
            })}
          </Chart>
        </ResponsiveContainer>
      </div>
      <table className="sr-only">
        <caption>{chart.title}</caption>
        <thead>
          <tr>
            <th scope="col">Label</th>
            {series.map((name) => (
              <th key={name} scope="col">
                {name}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {chart.rows.map((row) => (
            <tr key={row.label}>
              <th scope="row">{row.label}</th>
              {rowValues(row).map((value, i) => (
                <td key={i}>{printed(chart, value)}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * The chart on the whole screen, for a plot too small to read on a phone or
 * a table too wide for one. A native modal dialog, so the thread behind is
 * inert; Escape, the close button and a press on the backdrop close it.
 */
function FullScreen({
  chart,
  measure,
  tipAt,
  onClose,
}: {
  chart: DashChart;
  measure: string | null;
  tipAt?: number;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    if (dialog && !dialog.open) dialog.showModal();
    // Focus the panel, not the close button, so a tap does not open on a focus ring.
    panel.current?.focus();
  }, []);
  return (
    <dialog
      ref={ref}
      aria-label={chart.title}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onClick={(event) => {
        if (event.target === ref.current) onClose();
      }}
      className="m-0 h-dvh max-h-none w-screen max-w-none bg-transparent p-0 text-ink backdrop:bg-black/40 sm:p-6 sm:open:flex sm:open:items-center"
    >
      <div
        ref={panel}
        tabIndex={-1}
        className="mx-auto flex h-full w-full flex-col overflow-y-auto bg-surface px-4 pb-6 pt-3 outline-none focus:outline-none focus-visible:outline-none sm:h-auto sm:max-h-full sm:max-w-5xl sm:rounded-card sm:px-6"
      >
        <div className="mb-3 flex items-start justify-between gap-3">
          <div className="pt-1">
            <h2 className="font-display text-title font-semibold tracking-tight text-ink">
              {chart.title}
            </h2>
            {measure && <p className="mt-0.5 text-small text-ink-muted">{measure}</p>}
          </div>
          <IconButton label="Close" onClick={onClose}>
            <X strokeWidth={1.75} />
          </IconButton>
        </div>
        <div className={cn(chart.kind === 'table' && 'rounded-card bg-sunken px-3 pb-2 pt-2.5')}>
          {chart.kind === 'table' ? (
            <Rows chart={chart} />
          ) : (
            <Plot chart={chart} tall tipAt={tipAt} />
          )}
        </div>
      </div>
    </dialog>
  );
}

/**
 * The one number a question asked for, large, with how far it sits from the
 * usual amount or the target beside it. The change is told in words in the
 * ink of the text: more spending is not always worse, so it takes no
 * good-or-bad colour.
 */
function Figure({ chart }: { chart: DashChart }) {
  const row = chart.rows[0];
  const change = chartChange(chart);
  const reference = chart.reference;
  return (
    <div>
      <p className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className="tabular font-display text-figure font-semibold leading-none tracking-tight text-ink">
          {chartValue(chart, row.value)}
          {!chart.currency && chart.unit ? (
            <span className="ml-1.5 text-body font-normal text-ink-muted">{chart.unit}</span>
          ) : null}
        </span>
        {change !== null && reference && (
          <Chip className="bg-canvas text-ink">
            {change === 0 ? 'Same as usual' : `${change > 0 ? '↑' : '↓'} ${Math.abs(change)}%`}
          </Chip>
        )}
      </p>
      <p className="mt-1.5 text-small text-ink-muted">
        {row.label}
        {reference && (
          <>
            {' · '}
            {change !== null && change !== 0
              ? `${Math.abs(change)}% ${change > 0 ? 'more' : 'less'} than `
              : ''}
            {reference.label}, <span className="tabular">{chartValue(chart, reference.value)}</span>
          </>
        )}
      </p>
    </div>
  );
}

/** The plot's height, in pixels: room for twelve months without the reply growing tall. */
const COLUMNS_H = 112;

/**
 * One amount over time, oldest first. The last column is the period the
 * question asked about, so it alone wears the accent and its value; the
 * others are read on hover or from the list a screen reader hears. A
 * reference is a dashed line across them at its height, named in a key
 * under the plot.
 */
function Columns({ chart }: { chart: DashChart }) {
  const reference = chart.reference;
  const max = Math.max(0, reference?.value ?? 0, ...chart.rows.map((row) => row.value));
  const at = (value: number) => (max === 0 ? 0 : (value / max) * COLUMNS_H);
  const last = chart.rows.length - 1;
  return (
    <div>
      <div className="relative" style={{ height: COLUMNS_H + 18 }}>
        {reference && (
          <div
            aria-hidden
            className="pointer-events-none absolute inset-x-0 border-t border-dashed border-ink-muted"
            style={{ bottom: at(reference.value) }}
          />
        )}
        <ul className="flex h-full items-end gap-1.5" aria-label={chart.title}>
          {chart.rows.map((row, i) => {
            const value = chartValue(chart, row.value);
            const current = i === last;
            return (
              <li
                key={`${i}-${row.label}`}
                className="flex h-full min-w-0 flex-1 flex-col items-center justify-end"
                title={`${row.label}: ${value}`}
              >
                <span className="sr-only">
                  {row.label}: {value}
                </span>
                {current && (
                  <span
                    aria-hidden
                    className="tabular mb-1 whitespace-nowrap text-small font-medium text-ink"
                  >
                    {value}
                  </span>
                )}
                <span
                  aria-hidden
                  className={cn(
                    'w-full max-w-10 rounded-t-control transition-opacity duration-quick hover:opacity-80',
                    current ? 'bg-accent' : 'bg-ink-muted/35',
                  )}
                  style={{ height: Math.max(row.value > 0 ? 2 : 0, at(row.value)) }}
                />
              </li>
            );
          })}
        </ul>
      </div>
      <div aria-hidden className="mt-1.5 flex gap-1.5">
        {chart.rows.map((row, i) => (
          <span
            key={`${i}-${row.label}`}
            className={cn(
              'min-w-0 flex-1 truncate text-center text-micro',
              i === last ? 'font-medium text-ink' : 'text-ink-muted',
            )}
          >
            {row.label}
          </span>
        ))}
      </div>
      {/* The line's name in a key under the plot, where no column can be under it. */}
      {reference && (
        <p className="mt-2 flex items-center gap-1.5 text-small text-ink-muted">
          <span aria-hidden className="w-4 border-t border-dashed border-ink-muted" />
          <span>
            {reference.label}, <span className="tabular">{chartValue(chart, reference.value)}</span>
          </span>
        </p>
      )}
    </div>
  );
}

/** The kinds that open full screen: a plot to read closer, a table with several columns. */
function opens(chart: DashChart): boolean {
  return (
    chart.kind === 'line' ||
    chart.kind === 'area' ||
    (chart.kind === 'table' && Boolean(chart.series))
  );
}

export function ReplyChart({
  chart,
  startFull = false,
  tipAt,
}: {
  chart: DashChart;
  /** Open full screen from the start. For the preview gallery's shots. */
  startFull?: boolean;
  /** Show the tooltip at this point from the start. For the preview gallery's shots. */
  tipAt?: number;
}) {
  const [full, setFull] = useState(startFull);
  const plotted = chart.kind === 'line' || chart.kind === 'area';
  const measure = chart.unit === '%' ? 'Change since the first, %' : (chart.currency ?? chart.unit);
  return (
    <figure className="mt-2 rounded-card bg-sunken px-3 pb-3 pt-2.5">
      {opens(chart) ? (
        <figcaption className="mb-2 flex items-start justify-between gap-x-3 text-ui font-medium text-ink">
          <span className="min-w-0 flex-1 pt-0.5">
            {chart.title}
            {plotted && measure ? (
              <span className="block text-small font-normal text-ink-muted">{measure}</span>
            ) : null}
          </span>
          <IconButton label="Open full screen" size="sm" onClick={() => setFull(true)}>
            <Maximize2 strokeWidth={1.75} />
          </IconButton>
        </figcaption>
      ) : (
        <figcaption className="mb-2 flex flex-wrap items-baseline justify-between gap-x-3 text-ui font-medium text-ink">
          <span className="min-w-0">{chart.title}</span>
          {(chart.kind === 'bar' || chart.kind === 'columns') && (chart.unit || chart.currency) ? (
            <span className="text-small font-normal text-ink-muted">
              {chart.currency ?? chart.unit}
            </span>
          ) : null}
        </figcaption>
      )}
      {chart.kind === 'bar' ? (
        <Bars chart={chart} />
      ) : chart.kind === 'columns' ? (
        <Columns chart={chart} />
      ) : chart.kind === 'figure' ? (
        <Figure chart={chart} />
      ) : plotted ? (
        <Plot chart={chart} tipAt={full ? undefined : tipAt} />
      ) : (
        <Rows chart={chart} />
      )}
      {full && (
        <FullScreen
          chart={chart}
          measure={plotted ? measure : null}
          tipAt={tipAt}
          onClose={() => setFull(false)}
        />
      )}
    </figure>
  );
}

/** Every chart an answer drew; nothing for an answer that drew none. */
export function ReplyCharts({ calls }: { calls: readonly TalkToolCall[] | undefined }) {
  const charts = turnCharts(calls);
  if (charts.length === 0) return null;
  return (
    <>
      {charts.map((chart, i) => (
        <ReplyChart key={`${i}-${chart.title}`} chart={chart} />
      ))}
    </>
  );
}

/**
 * The charts a bot on People drew with a bubble (plan #3050.2.2), under it in
 * the thread, wide enough for their lines and opening full screen as Ask's do.
 * Nothing for a bubble that drew none.
 */
export function BubbleCharts({
  charts,
  startFull,
  tipAt,
}: {
  charts: readonly DashChart[] | undefined;
  /** For the preview gallery's shots: the first chart open full screen. */
  startFull?: boolean;
  /** For the preview gallery's shots: the tooltip at this point. */
  tipAt?: number;
}) {
  if (!charts || charts.length === 0) return null;
  return (
    <MessageCard wide label={charts.length === 1 ? 'Chart drawn with this message' : 'Charts drawn with this message'}>
      {charts.map((chart, i) => (
        <ReplyChart key={`${i}-${chart.title}`} chart={chart} startFull={Boolean(startFull) && i === 0} tipAt={tipAt} />
      ))}
    </MessageCard>
  );
}
