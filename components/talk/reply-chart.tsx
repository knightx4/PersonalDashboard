import { Meter } from '@/components/ui/meter';
import {
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
          <th scope="col" className="pb-1.5 text-left text-micro font-semibold uppercase tracking-wider text-ink-muted">
            {label || <span className="sr-only">Row</span>}
          </th>
          <th scope="col" className="pb-1.5 pl-3 text-right text-micro font-semibold uppercase tracking-wider text-ink-muted">
            {value}
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

export function ReplyChart({ chart }: { chart: DashChart }) {
  return (
    <figure className="mt-2 rounded-card bg-sunken px-3 pb-3 pt-2.5">
      <figcaption className="mb-2 flex flex-wrap items-baseline justify-between gap-x-3 text-ui font-medium text-ink">
        <span className="min-w-0">{chart.title}</span>
        {chart.kind === 'bar' && (chart.unit || chart.currency) ? (
          <span className="text-small font-normal text-ink-muted">{chart.currency ?? chart.unit}</span>
        ) : null}
      </figcaption>
      {chart.kind === 'bar' ? <Bars chart={chart} /> : <Rows chart={chart} />}
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
