'use client';

import { useState } from 'react';
import { Area, AreaChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { cn } from '@/lib/cn';
import { hueFill } from '@/lib/learn/map/view';
import { axisNumber, niceTicks, chartSeries, rowValue, seriesValue, type DashChart } from '@/lib/talk/chart';

/**
 * A line or an area Dash drew (plan #3050.2.1), with up to four series over
 * the same labels, drawn with recharts as the Learn chart figure is
 * (lib/learn/figures/kinds/chart-plot.tsx).
 *
 * Points are joined by straight lines: the figures are one a day or a
 * month, and a smoothed curve would draw movement between them nobody
 * measured. The scale steps in round amounts (lib/talk/chart.ts niceTicks).
 *
 * One series is the accent: it is what the question is about. Several are
 * peers, such as three indices, so each takes one of the fixed category hues
 * of Part 10, rule 10, and the key above the plot names each. Pressing a
 * name in the key picks that series out, fading the others to a quarter
 * (rule 3), and pressing it again clears it, so colour is never the only way
 * to tell the lines apart. Hovering, or a tap on a phone, names the label and
 * every series' value at it.
 *
 * A screen reader hears the same figures as a table, since the plot is a
 * picture to it.
 */

/** Slots in the Learn map's ten fixed hues: blue, amber, purple and teal, apart from each other and from red and green. */
const HUE_SLOTS = [1, 5, 7, 4] as const;

/**
 * The colour of each series, as a value the marks read from the chart's own
 * box (`seriesHues`), where the theme's light or dark is known.
 */
export function seriesColour(index: number, count: number): string {
  if (count === 1) return 'var(--c-accent)';
  return `var(--series-${index % HUE_SLOTS.length})`;
}

/** The series colours set on the chart's box, each the hue's light or dark as the theme is. */
export function seriesHues(): Record<string, string> {
  return Object.fromEntries(HUE_SLOTS.map((slot, index) => [`--series-${index}`, hueFill(slot)]));
}

const AXIS_TICK = { fill: 'var(--c-ink-muted)', fontSize: 12 };

const TOOLTIP = {
  contentStyle: {
    borderRadius: '0.5rem',
    borderColor: 'var(--c-border-strong)',
    backgroundColor: 'var(--c-raised)',
    color: 'var(--c-ink)',
    fontSize: 12,
    boxShadow: 'var(--sheet-edge, 0 6px 20px -6px rgb(0 0 0 / 0.18))',
  },
  itemStyle: { color: 'var(--c-ink)' },
  labelStyle: { color: 'var(--c-ink-muted)' },
};


export function ReplyTrend({ chart, large = false }: { chart: DashChart; large?: boolean }) {
  const series = chartSeries(chart);
  const [picked, setPicked] = useState<number | null>(null);
  const keys = series.map((_, index) => `s${index}`);
  const data = chart.rows.map((row) => {
    const point: Record<string, string | number | null> = { label: row.label };
    series.forEach((_, index) => {
      point[keys[index]!] = rowValue(chart, row, index);
    });
    return point;
  });
  const percent = series.every((s) => s.unit === '%');
  const tick = (value: number) => (percent ? `${axisNumber(value)}%` : axisNumber(value));
  // Wide enough for the longest tick, a minus sign and a % included, so none is clipped.
  const values = data.flatMap((point) => keys.map((key) => point[key])).filter((v): v is number => typeof v === 'number');
  // Round steps (0.5%, 1,000) rather than whatever recharts divides the range into.
  const ticks = niceTicks(chart.kind === 'area' ? Math.min(0, ...values) : Math.min(...values), Math.max(...values));
  const longest = Math.max(...ticks.map((v) => tick(v).length + 1));
  const axisWidth = Math.max(36, 8 + longest * 7);
  const strength = (index: number) => (picked === null || picked === index ? 1 : 0.25);
  const many = series.length > 1;

  const axes = (
    <>
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
        width={axisWidth}
        tickFormatter={tick}
        ticks={ticks}
        domain={[ticks[0]!, ticks[ticks.length - 1]!]}
      />
      <Tooltip
        {...TOOLTIP}
        cursor={{ stroke: 'var(--c-border-strong)' }}
        formatter={(value, name) => {
          const index = keys.indexOf(String(name));
          return [seriesValue(chart, series[index], typeof value === 'number' ? value : null), series[index]?.name ?? String(name)];
        }}
      />
    </>
  );

  return (
    <div style={seriesHues()} className={cn(large && 'flex h-full flex-col')}>
      {many && (
        <ul aria-label="Series" className="mb-2 flex flex-wrap gap-x-1 gap-y-1">
          {series.map((s, index) => (
            <li key={s.name}>
              <button
                type="button"
                aria-pressed={picked === index}
                onClick={() => setPicked((current) => (current === index ? null : index))}
                className={cn(
                  'press inline-flex min-h-7 items-center gap-1.5 rounded-control px-1.5 text-small transition-opacity duration-quick',
                  'hover:bg-surface focus-visible:outline-2 focus-visible:outline-offset-2',
                  picked === index ? 'text-ink' : 'text-ink-muted',
                )}
                style={{ opacity: strength(index) === 1 ? 1 : 0.6 }}
              >
                <span aria-hidden className="h-0.5 w-3.5 rounded-full" style={{ backgroundColor: seriesColour(index, series.length) }} />
                {s.name}
              </button>
            </li>
          ))}
        </ul>
      )}
      <div
        aria-hidden
        className={cn('w-full', large ? 'min-h-56 flex-1' : 'h-44 sm:h-52')}
      >
        <ResponsiveContainer width="100%" height="100%">
          {chart.kind === 'area' ? (
            <AreaChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
              {axes}
              {keys.map((key, index) => (
                <Area
                  key={key}
                  dataKey={key}
                  name={key}
                  type="linear"
                  stroke={seriesColour(index, series.length)}
                  strokeWidth={2} /* ui-ok: a chart's line, drawn as the Learn chart's are, not an icon */
                  strokeOpacity={strength(index)}
                  fill={seriesColour(index, series.length)}
                  fillOpacity={0.12 * strength(index)}
                  dot={false}
                  activeDot={{ r: 4, strokeWidth: 2, stroke: 'var(--c-surface)' }}
                  connectNulls
                  isAnimationActive={false}
                />
              ))}
            </AreaChart>
          ) : (
            <LineChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
              {axes}
              {keys.map((key, index) => (
                <Line
                  key={key}
                  dataKey={key}
                  name={key}
                  type="linear"
                  stroke={seriesColour(index, series.length)}
                  strokeWidth={picked === index ? 2.5 : 2}
                  strokeOpacity={strength(index)}
                  dot={chart.rows.length <= 12 ? { r: 2.5, strokeWidth: 0, fill: seriesColour(index, series.length), fillOpacity: strength(index) } : false}
                  activeDot={{ r: 4, strokeWidth: 2, stroke: 'var(--c-surface)' }}
                  connectNulls
                  isAnimationActive={false}
                />
              ))}
            </LineChart>
          )}
        </ResponsiveContainer>
      </div>
      <table className="sr-only">
        <caption>{chart.title}</caption>
        <thead>
          <tr>
            <th scope="col">Label</th>
            {series.map((s) => (
              <th key={s.name} scope="col">
                {s.name}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {chart.rows.map((row, i) => (
            <tr key={`${i}-${row.label}`}>
              <th scope="row">{row.label}</th>
              {series.map((s, index) => (
                <td key={s.name}>{seriesValue(chart, s, rowValue(chart, row, index))}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
