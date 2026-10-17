import { Meter } from '@/components/ui/meter';
import { Chip } from '@/components/ui/chip';
import { cn } from '@/lib/cn';
import { SectionLabel } from '@/components/ui/section-heading';
import {
  chartChange,
  chartColumns,
  chartValue,
  turnCharts,
  type DashChart,
} from '@/lib/talk/chart';
import type { TalkToolCall } from '@/lib/talk/talk';

/**
 * The charts Dash drew in an answer (plan #1655), read from the turn's kept
 * tool calls (lib/talk/chart.ts), so a reopened answer draws them as it did.
 * Bars are the merchant breakdown's rows (components/dashboard/
 * merchant-breakdown.tsx): the label and the figure on one line, the meter
 * under them, where the length compares rows and the figure is read.
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
 * A two-column table drawn by hand rather than with components/ui/table.tsx:
 * that one fades its right edge on a phone to show it scrolls, and a column
 * of figures this narrow never needs to, so the fade only hid the numbers.
 */
function Rows({ chart }: { chart: DashChart }) {
  const [label, value] = chartColumns(chart);
  return (
    <table className="w-full border-collapse text-ui">
      <thead>
        <tr>
          <th scope="col" className="pb-1.5 text-left font-normal">
            {label ? <SectionLabel as="span">{label}</SectionLabel> : <span className="sr-only">Row</span>}
          </th>
          <th scope="col" className="pb-1.5 pl-3 text-right font-normal">
            <SectionLabel as="span">{value}</SectionLabel>
          </th>
        </tr>
      </thead>
      <tbody className="divide-y divide-border">
        {chart.rows.map((row, i) => (
          <tr key={`${i}-${row.label}`}>
            <td className="py-2 text-ink">{row.label}</td>
            <td className="tabular whitespace-nowrap py-2 pl-3 text-right text-ink">{chartValue(chart, row.value)}</td>
          </tr>
        ))}
      </tbody>
    </table>
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

export function ReplyChart({ chart }: { chart: DashChart }) {
  return (
    <figure className="mt-2 rounded-card bg-sunken px-3 pb-3 pt-2.5">
      <figcaption className="mb-2 flex flex-wrap items-baseline justify-between gap-x-3 text-ui font-medium text-ink">
        <span className="min-w-0">{chart.title}</span>
        {(chart.kind === 'bar' || chart.kind === 'columns') && (chart.unit || chart.currency) ? (
          <span className="text-small font-normal text-ink-muted">{chart.currency ?? chart.unit}</span>
        ) : null}
      </figcaption>
      {chart.kind === 'bar' ? (
        <Bars chart={chart} />
      ) : chart.kind === 'columns' ? (
        <Columns chart={chart} />
      ) : chart.kind === 'figure' ? (
        <Figure chart={chart} />
      ) : (
        <Rows chart={chart} />
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
