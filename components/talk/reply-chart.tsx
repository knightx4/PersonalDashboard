'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { ArrowDown, ArrowUp, Maximize2, X } from 'lucide-react';
import { Meter } from '@/components/ui/meter';
import { Chip } from '@/components/ui/chip';
import { IconButton } from '@/components/ui/icon-button';
import { Tooltip } from '@/components/ui/tooltip';
import { cn } from '@/lib/cn';
import { SectionLabel } from '@/components/ui/section-heading';
import {
  chartChange,
  chartValue,
  isTrend,
  nextSort,
  rowValue,
  seriesValue,
  sortRows,
  tableHeadings,
  turnCharts,
  type ChartSort,
  type DashChart,
} from '@/lib/talk/chart';
import type { TalkToolCall } from '@/lib/talk/talk';
import { MessageCard } from '@/components/patterns/messaging';
import { ReplyTrend } from './reply-trend';

/**
 * The charts Dash drew in an answer (plan #1655), read from the turn's kept
 * tool calls (lib/talk/chart.ts), so a reopened answer draws them as it did.
 * Bars are the merchant breakdown's rows (components/dashboard/
 * merchant-breakdown.tsx): the label and the figure on one line, the meter
 * under them, where the length compares rows and the figure is read.
 *
 * A line, an area or a table (plan #3050.2.1) opens full screen from the
 * button by its title, and a table sorts by any heading pressed. The same
 * charts draw under a bot's text in a People thread (plan #3050.2.2).
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

/**
 * A table drawn by hand rather than with components/ui/table.tsx: that one
 * fades its right edge on a phone to show it scrolls, and a column of figures
 * this narrow never needs to, so the fade only hid the numbers. A table with
 * several series can be wider than a phone; it scrolls sideways under its
 * labels, which stay put.
 *
 * Each heading is a button that sorts by its column: figures largest first,
 * labels A to Z, then the other way, then back to the order Dash gave.
 */
function Rows({ chart }: { chart: DashChart }) {
  const [sort, setSort] = useState<ChartSort>(null);
  const headings = tableHeadings(chart);
  const series = chart.series && chart.series.length > 0 ? chart.series : null;
  const wide = series !== null && series.length > 1;
  const rows = sortRows(chart, sort);
  const cell = (row: DashChart['rows'][number], index: number) =>
    series ? seriesValue(chart, series[index], rowValue(chart, row, index)) : chartValue(chart, row.value);

  const heading = (text: string, column: number) => {
    const sorted = sort?.column === column ? sort.direction : null;
    const Arrow = sorted === 'asc' ? ArrowUp : ArrowDown;
    return (
      <th
        key={column}
        scope="col"
        aria-sort={sorted === 'asc' ? 'ascending' : sorted === 'desc' ? 'descending' : undefined}
        className={cn(
          'pb-1.5 font-normal',
          column < 0 ? 'text-left' : 'pl-3 text-right',
          column < 0 && wide && 'sticky left-0 z-10 bg-sunken',
        )}
      >
        <button
          type="button"
          onClick={() => setSort((current) => nextSort(current, column))}
          className={cn(
            'press -mx-1 inline-flex items-center gap-1 rounded-control px-1 py-0.5 hover:bg-surface focus-visible:outline-2 focus-visible:outline-offset-2',
            column >= 0 && 'flex-row-reverse',
          )}
        >
          {text ? <SectionLabel as="span">{text}</SectionLabel> : <span className="sr-only">Row</span>}
          <Arrow aria-hidden strokeWidth={1.75} className={cn('size-3 text-ink-muted', !sorted && 'opacity-0')} />
          <span className="sr-only">, sort</span>
        </button>
      </th>
    );
  };

  return (
    <div className={cn(wide && '-mx-3 overflow-x-auto px-3')}>
      <table className={cn('w-full border-collapse text-ui', wide && 'min-w-max')}>
        <thead>
          <tr>{headings.map((text, i) => heading(text, i - 1))}</tr>
        </thead>
        <tbody className="divide-y divide-border">
          {rows.map((row, i) => (
            <tr key={`${i}-${row.label}`}>
              <td
                className={cn('py-2 text-ink', wide && 'sticky left-0 max-w-40 truncate bg-sunken pr-2')}
                title={wide ? row.label : undefined}
              >
                {row.label}
              </td>
              {headings.slice(1).map((_, index) => (
                <td key={index} className="tabular whitespace-nowrap py-2 pl-3 text-right text-ink">
                  {cell(row, index)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
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
          {!chart.currency && chart.unit ? <span className="ml-1.5 text-body font-normal text-ink-muted">{chart.unit}</span> : null}
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
            {change !== null && change !== 0 ? `${Math.abs(change)}% ${change > 0 ? 'more' : 'less'} than ` : ''}
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
                  <span aria-hidden className="tabular mb-1 whitespace-nowrap text-small font-medium text-ink">
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
            className={cn('min-w-0 flex-1 truncate text-center text-micro', i === last ? 'font-medium text-ink' : 'text-ink-muted')}
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

/** The kinds that open full screen: the ones with more to read than a reply's width shows. */
function opens(chart: DashChart): boolean {
  return isTrend(chart.kind) || chart.kind === 'table';
}

/** What the chart draws, at the reply's width or, `large`, full screen. */
function Body({ chart, large = false }: { chart: DashChart; large?: boolean }) {
  if (isTrend(chart.kind)) return <ReplyTrend chart={chart} large={large} />;
  if (chart.kind === 'bar') return <Bars chart={chart} />;
  if (chart.kind === 'columns') return <Columns chart={chart} />;
  if (chart.kind === 'figure') return <Figure chart={chart} />;
  return <Rows chart={chart} />;
}

/** What a caption names beside the title: the currency or unit every value is in. */
function captionUnit(chart: DashChart): string | null {
  if (chart.kind === 'bar' || chart.kind === 'columns') return chart.currency ?? chart.unit;
  // A series' own unit, such as %, is on the axis's ticks already.
  if (isTrend(chart.kind)) return chart.currency ?? chart.unit;
  return null;
}

/**
 * The chart over the whole screen, a native modal so the page behind is
 * inert and focus stays inside. Escape, Close or a press on the backdrop
 * shuts it.
 */
function FullScreen({ chart, onClose }: { chart: DashChart; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const dialog = ref.current;
    if (dialog && !dialog.open) dialog.showModal();
  }, []);
  const unit = captionUnit(chart);
  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onClick={(event) => {
        if (event.target === ref.current) onClose();
      }}
      className="m-0 h-dvh max-h-none w-screen max-w-none bg-surface p-0 text-ink shadow-lg backdrop:bg-black/40 sm:m-auto sm:h-[calc(100dvh-3rem)] sm:w-[calc(100vw-3rem)] sm:rounded-card"
    >
      <div className="flex h-full flex-col px-4 pb-5 pt-3 sm:px-6">
        <div className="flex items-start justify-between gap-3">
          <h2 id={titleId} className="min-w-0 pt-1 font-display text-title font-semibold tracking-tight text-ink">
            {chart.title}
            {unit && <span className="ml-2 text-ui font-normal text-ink-muted">{unit}</span>}
          </h2>
          <Tooltip label="Close" align="end">
            <IconButton label="Close" onClick={onClose}>
              <X strokeWidth={1.75} aria-hidden />
            </IconButton>
          </Tooltip>
        </div>
        <div className="mt-4 min-h-0 flex-1 overflow-auto rounded-card bg-sunken px-3 pb-3 pt-3">
          <Body chart={chart} large />
        </div>
      </div>
    </dialog>
  );
}

/** One chart under a reply; `defaultOpen` draws it full screen at once, as the gallery shows it. */
export function ReplyChart({ chart, defaultOpen = false, className }: { chart: DashChart; defaultOpen?: boolean; className?: string }) {
  const [open, setOpen] = useState(defaultOpen && opens(chart));
  const unit = captionUnit(chart);
  return (
    <figure className={cn('mt-2 rounded-card bg-sunken px-3 pb-3 pt-2.5', className)}>
      <figcaption className="mb-2 flex items-start justify-between gap-x-3 text-ui font-medium text-ink">
        <span className="flex min-w-0 flex-wrap items-baseline gap-x-3">
          <span className="min-w-0">{chart.title}</span>
          {unit ? <span className="text-small font-normal text-ink-muted">{unit}</span> : null}
        </span>
        {opens(chart) && (
          <Tooltip label="Open full screen" align="end">
            <IconButton size="sm" label="Open full screen" className="-mr-1 -mt-0.5" onClick={() => setOpen(true)}>
              <Maximize2 strokeWidth={1.75} aria-hidden />
            </IconButton>
          </Tooltip>
        )}
      </figcaption>
      <Body chart={chart} />
      {open && <FullScreen chart={chart} onClose={() => setOpen(false)} />}
    </figure>
  );
}

/**
 * The charts a bot on People drew with a text (plan #3050.2.2), kept on its
 * message, under its bubble in the run: the same charts Ask draws, a card's
 * width wide. Voice reads the bubble's words and never these.
 */
export function MessageCharts({ charts }: { charts: readonly DashChart[] | undefined }) {
  if (!charts || charts.length === 0) return null;
  return (
    <MessageCard wide>
      {charts.map((chart, i) => (
        <ReplyChart key={`${i}-${chart.title}`} chart={chart} className="mt-0.5" />
      ))}
    </MessageCard>
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
