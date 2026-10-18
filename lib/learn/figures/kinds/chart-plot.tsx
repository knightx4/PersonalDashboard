'use client';

import { Bar, BarChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import type { ChartLine, ChartStyle } from './chart-data';
import { compactNumber, plotRows } from './chart-data';

/**
 * The plot of a chart figure (plan #2321.3), drawn with recharts on the
 * client. One scale per plot: two lines share it only when they are the same
 * measure in two places; two different measures are two plots, one above the
 * other (`plotGroups`), never a second axis. The first line, the one the
 * caption is about, is the accent,
 * the second muted ink, and the legend above names both, so colour is never
 * the only way to tell them apart. Hovering names the year and its values.
 */

/**
 * The marks and the tooltip take their colours from the `--c-*` values, read
 * where they are drawn. The `--color-*` names compute at :root, where the
 * scoped ones (the accent above all) are empty, so a mark given
 * `var(--color-accent)` draws nothing. The two series colours are read onto
 * the plot's own box, inside the workspace's scope.
 */
const COLOURS = ['var(--chart-first)', 'var(--chart-second)'] as const;

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

export function ChartPlot({ style, lines, colourFrom = 0 }: { style: ChartStyle; lines: readonly ChartLine[]; colourFrom?: number }) {
  const rows = plotRows(lines);
  const keys = lines.map((_, index) => `s${index}`);
  const format = (value: unknown) => (typeof value === 'number' ? compactNumber(value) : String(value));
  const axes = (
    <>
      <CartesianGrid vertical={false} stroke="var(--c-border)" strokeDasharray="2 4" />
      <XAxis
        dataKey="year"
        tick={AXIS_TICK}
        tickLine={false}
        axisLine={{ stroke: 'var(--c-border)' }}
        minTickGap={24}
        tickMargin={6}
        padding={{ left: 8 }}
      />
      <YAxis
        tick={AXIS_TICK}
        tickLine={false}
        axisLine={false}
        width={44}
        tickFormatter={(value: number) => compactNumber(value)}
        domain={style === 'bar' ? [0, 'auto'] : ['auto', 'auto']}
      />
      <Tooltip
        {...TOOLTIP}
        cursor={style === 'bar' ? { fill: 'var(--c-sunken)' } : { stroke: 'var(--c-border-strong)' }}
        formatter={(value, name) => [format(value), lines[keys.indexOf(String(name))]?.label ?? String(name)]}
      />
    </>
  );
  return (
    <div className="h-48 w-full [--chart-first:var(--c-accent)] [--chart-second:var(--c-ink-muted)] sm:h-56">
      <ResponsiveContainer width="100%" height="100%">
        {style === 'bar' ? (
          <BarChart data={rows} margin={{ top: 8, right: 8, bottom: 0, left: 0 }} barGap={2} barCategoryGap="20%">
            {axes}
            {keys.map((key, index) => (
              <Bar
                key={key}
                dataKey={key}
                name={key}
                fill={COLOURS[(index + colourFrom) % COLOURS.length]}
                radius={[4, 4, 0, 0]}
                isAnimationActive={false}
              />
            ))}
          </BarChart>
        ) : (
          <LineChart data={rows} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
            {axes}
            {keys.map((key, index) => (
              <Line
                key={key}
                dataKey={key}
                name={key}
                type="monotone"
                stroke={COLOURS[(index + colourFrom) % COLOURS.length]}
                strokeWidth={2}
                dot={false}
                activeDot={{ r: 4, strokeWidth: 2, stroke: 'var(--c-surface)' }}
                connectNulls
                isAnimationActive={false}
              />
            ))}
          </LineChart>
        )}
      </ResponsiveContainer>
    </div>
  );
}
